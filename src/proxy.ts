import { InstanceId } from "aws-sdk/clients/ec2";
import fs from "fs";
import { EC2Client } from "./ec2";
import { PausingProxy } from "./pausingProxy";

interface Config {
  instanceId: InstanceId;
  port: number;
  proxyPort?: number;
  clientTimeout?: number;
  inactiveShutdownMs?: number;
}

(JSON.parse(
  fs.readFileSync(process.argv[2], { encoding: "utf-8" })
) as Config[]).forEach(config => {
  new PausingProxy(
    new EC2Client(config.instanceId),
    config.port,
    config.clientTimeout ?? 120000
  ).listen(config.proxyPort ?? config.port);
});
