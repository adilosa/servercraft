import { EC2 } from "aws-sdk";
import { InstanceId } from "aws-sdk/clients/ec2";

const POLLING_RATE = 1000;

export class EC2Client {
  ec2: AWS.EC2;
  instanceId: InstanceId;

  constructor(instanceId: InstanceId) {
    this.ec2 = new EC2();
    this.instanceId = instanceId;
  }

  async start() {
    if (!(await this._checkIsRunning())) {
      console.log("Starting instance");
      const start = new Date().getTime();
      await this.ec2
        .startInstances({ InstanceIds: [this.instanceId] })
        .promise();
      await this._waitForRunningState();

      const elapsedSec = (new Date().getTime() - start) / 1000;
      console.log(`Instance running after ${elapsedSec}s`);
    }
  }

  async stop() {
    console.log("Requesting stop of instance");
    return this.ec2
      .stopInstances({ InstanceIds: [this.instanceId], Hibernate: true })
      .promise();
  }

  async ipAddress() {
    return (
      await this.ec2
        .describeInstances({
          InstanceIds: [this.instanceId]
        })
        .promise()
    ).Reservations?.[0].Instances?.[0].PublicIpAddress;
  }

  async _waitForRunningState() {
    console.log("Waiting for instance to be in running state");
    while (true) {
      try {
        if (await this._checkIsRunning()) {
          break;
        }
      } catch {
        break;
      }
      await this.sleep(POLLING_RATE);
    }
    return new Promise((resolve, reject) => {
      const check = async () => {
        try {
          if (await this._checkIsRunning()) {
            clearInterval(handle);
            resolve();
          }
        } catch (err) {
          clearInterval(handle);
          reject(err);
        }
      };

      const handle = setInterval(check, POLLING_RATE);
      check();
    });
  }

  sleep(ms: number) {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  async _checkIsRunning() {
    return (
      (
        await this.ec2
          .describeInstanceStatus({
            IncludeAllInstances: true,
            InstanceIds: [this.instanceId]
          })
          .promise()
      ).InstanceStatuses?.[0].InstanceState?.Name === "running"
    );
  }
}
