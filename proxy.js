import EC2Client from "./lib/ec2";
import PausingProxy from "./lib/pausingProxy";

const configs = [
  {
    proxyPort: 21025,
    clientTimeout: 120000,
    instanceId: process.env.STARBOUND_INSTANCE_ID,
    startupDelay: 16000,
    inactiveShutdownSecs: 900000
  },
  {
    proxyPort: 25565,
    clientTimeout: 120000,
    instanceId: process.env.MINECRAFT_INSTANCE_ID,
    startupDelay: 16000,
    inactiveShutdownSecs: 900000
  }
];

configs.forEach(config => {
  let inactivityTimeout = null;

  const proxy = new PausingProxy(config.forwardServer, config.clientTimeout);
  const instance = new EC2Client(config.instanceId, config.startupDelay);

  proxy.on("connections", async count => {
    console.log(`Client connection count is ${count}`);
    if (count > 0) {
      try {
        if (inactivityTimeout != null) {
          console.log("Cancelling instance shutdown");
          clearTimeout(inactivityTimeout);
          inactivityTimeout = null;
        }
        await instance.start();
        proxy.resume();
      } catch (err) {
        console.error("Failed to ensure server availability", err);
      }
    } else {
      try {
        if (inactivityTimeout == null) {
          console.log(
            `Instance will be shut down in ${config.inactiveShutdownSecs /
              1000}s if no connection activity`
          );
          inactivityTimeout = setTimeout(async () => {
            inactivityTimeout = null;
            proxy.pause();
            await instance.stop();
          }, config.inactiveShutdownSecs);
        }
      } catch (err) {
        console.error("Failed to perform scheduled shutdown", err);
      }
    }
  });

  proxy.listen(config.proxyPort);
});
