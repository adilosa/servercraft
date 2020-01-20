import { config, EC2 } from "aws-sdk";
config.update({
  region: process.env.INSTANCE_REGION,
  accessKeyId: process.env.AWS_ACCESS_ID,
  secretAccessKey: process.env.AWS_ACCESS_KEY
});

const POLLING_RATE = 5000;

const delay = async function(timeout) {
  return new Promise(resolve => {
    setTimeout(resolve, timeout);
  });
};

class EC2Client {
  constructor(instanceId) {
    this.ec2 = new EC2();
    this.instanceId = instanceId;
    console.log(`Instance ${this.instanceId} is target of EC2 client`);
  }

  async start() {
    return new Promise((resolve, reject) => {
      this._checkIsRunning((err, running) => {
        if (err) return reject(err);
        if (running) {
          console.log(`Instance is already running`);
          resolve();
        } else {
          console.log("Starting instance");
          const start = new Date().getTime();
          this.ec2.startInstances(
            { InstanceIds: [this.instanceId] },
            async (err, _data) => {
              if (err) return reject(err);

              try {
                await this._waitForRunningState();

                const elapsedSec = (new Date().getTime() - start) / 1000;
                console.log(`Instance running after ${elapsedSec}s`);
              } catch (err) {
                return reject(err);
              }

              resolve();
            }
          );
        }
      });
    });
  }

  async stop() {
    console.log("Requesting stop of instance");
    return new Promise((resolve, reject) => {
      this.ec2.stopInstances(
        { InstanceIds: [this.instanceId], Hibernate: true },
        (err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data);
          }
        }
      );
    });
  }

  async _waitForRunningState() {
    console.log("Waiting for instance to be in running state");
    return new Promise((resolve, reject) => {
      const check = () => {
        this._checkIsRunning((err, running) => {
          if (err) {
            clearInterval(handle);
            reject(err);
          } else if (running) {
            clearInterval(handle);
            resolve();
          }
        });
      };

      const handle = setInterval(check, POLLING_RATE);
      check();
    });
  }

  _checkIsRunning(cb) {
    this.ec2.describeInstanceStatus(
      { IncludeAllInstances: true, InstanceIds: [this.instanceId] },
      (err, data) => {
        if (err) return cb(err);
        cb(null, data.InstanceStatuses[0].InstanceState.Name === "running");
      }
    );
  }
}

export default EC2Client;
