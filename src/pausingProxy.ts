import net from "net";
import { EC2Client } from "./ec2";

export class PausingProxy {
  paused: boolean;
  ec2Instance: EC2Client;
  port: number;
  clientTimeout: number;
  proxy: net.Server;
  inactiveShutdownMillis: number;
  inactivityTimeout: NodeJS.Timeout | null = null;

  private oldCount = 0;

  constructor(
    ec2Instance: EC2Client,
    port: number,
    inactiveShutdownMillis = 900000,
    clientTimeout = 120000
  ) {
    this.paused = true;
    this.ec2Instance = ec2Instance;
    this.port = port;
    this.clientTimeout = clientTimeout;
    this.inactiveShutdownMillis = inactiveShutdownMillis;
    this.proxy = net.createServer(this._handleClientConnection.bind(this));
  }

  _checkConnections() {
    this.proxy.getConnections(async (err, count) => {
      if (err) throw err;
      if (count === this.oldCount) return;
      console.log(`Client connection count is ${count}`);
      if (this.inactivityTimeout != null) {
        clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = null;
      }
      if (count === 0 && this.oldCount > 0) {
        console.log("Scheduling instance shutdown");
        this.inactivityTimeout = setTimeout(async () => {
          this.inactivityTimeout = null;
          try {
            await this.ec2Instance.hibernate();
          } catch (e) {
            console.log("Error pausing proxy", e);
          }
        }, this.inactiveShutdownMillis);
      }
      this.oldCount = count;
    });
  }

  async _handleClientConnection(clientSocket: net.Socket) {
    console.log(`New proxy client at ${clientSocket.remoteAddress}`);
    clientSocket.setTimeout(this.clientTimeout);
    this._checkConnections();

    try {
      await this.ec2Instance.resume();

      const serverSocket = net.connect({
        host: await this.ec2Instance.ipAddress(),
        port: this.port
      });

      serverSocket.once("connect", () => {
        clientSocket.pipe(serverSocket);
        serverSocket.pipe(clientSocket);
        console.log(
          `Pipe established for client at ${clientSocket.remoteAddress}`
        );
      });

      const destroySockets = () => {
        console.log(`Pipe closed for client at ${clientSocket.remoteAddress}`);
        serverSocket.destroy();
        clientSocket.destroy();
        this._checkConnections();
      };

      serverSocket.once("timeout", destroySockets);
      serverSocket.once("close", destroySockets);
      serverSocket.once("error", destroySockets);

      clientSocket.once("close", destroySockets);
      clientSocket.once("error", destroySockets);
    } catch (err) {
      console.error("Error setting up pipe to server", err);
      clientSocket.destroy();
      this._checkConnections();
    }
  }

  listen(proxyPort: number) {
    console.log(
      `Proxying ${this.ec2Instance.instanceId}:${this.port} on ${proxyPort}`
    );
    this.proxy.listen(proxyPort);
    this._checkConnections();
  }
}
