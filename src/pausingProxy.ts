import EventEmitter from "events";
import net from "net";
import { EC2Client } from "./ec2";

export class PausingProxy extends EventEmitter {
  paused: boolean;
  ec2Instance: EC2Client;
  port: number;
  clientTimeout: number;
  proxy: net.Server;
  inactiveShutdownMillis: number;
  inactivityTimeout: NodeJS.Timeout | null = null;

  constructor(
    ec2Instance: EC2Client,
    port: number,
    inactiveShutdownMillis = 900000,
    clientTimeout = 12000
  ) {
    super();
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
      console.log(`Client connection count is ${count}`);
      if (this.inactivityTimeout != null) {
        clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = null;
      }
      if (count > 0) {
        try {
          await this.resume();
        } catch (e) {
          console.log("Error resuming proxy", e);
        }
      } else {
        console.log("Scheduling instance shutdown");
        this.inactivityTimeout = setTimeout(async () => {
          this.inactivityTimeout = null;
          try {
            await this.pause();
          } catch (e) {
            console.log("Error pausing proxy", e);
          }
        }, this.inactiveShutdownMillis ?? 900000);
      }
    });
  }

  async pause() {
    console.log("Pausing proxy");
    this.paused = true;
    await this.ec2Instance.stop();
    this.emit("paused");
  }

  async resume() {
    console.log("Resuming proxy");
    await this.ec2Instance.start();
    this.paused = false;
    this.emit("resumed");
  }

  async _resumedPromise() {
    return new Promise(resolve => {
      if (!this.paused) {
        resolve();
      } else {
        this.once("resumed", () => {
          resolve();
        });
      }
    });
  }

  async _handleClientConnection(clientSocket: net.Socket) {
    console.log(`New proxy client at ${clientSocket.remoteAddress}`);
    clientSocket.setTimeout(this.clientTimeout);
    this._checkConnections();

    try {
      await this._resumedPromise();

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
