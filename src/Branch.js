const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
const BRANCH_TO_BRANCH_PROTO_PATH = path.join(
  __dirname,
  "./protos/branch_to_branch.proto"
);
const CUSTOMER_TO_BRANCH_PROTO_PATH = path.join(
  __dirname,
  "./protos/customer_to_branch.proto"
);
const BRANCH_TO_BRANCH_PACKAGE_DEFINITION = protoLoader.loadSync(
  BRANCH_TO_BRANCH_PROTO_PATH
);
const CUSTOMER_TO_BRANCH_PACKAGE_DEFINITION = protoLoader.loadSync(
  CUSTOMER_TO_BRANCH_PROTO_PATH
);
const branchToBranchPackage = grpc.loadPackageDefinition(
  BRANCH_TO_BRANCH_PACKAGE_DEFINITION
).branchtobranch;
const customerToBranchPackage = grpc.loadPackageDefinition(
  CUSTOMER_TO_BRANCH_PACKAGE_DEFINITION
).customertobranch;

const BASE_PORT = process.env.BASE_PORT || 5000;

class Branch {
  static servers = [];
  static ids = [];
  constructor(id, balance) {
    this.id = id;
    this.balance = balance;
    this.clock = 1;
    this.events = [];
    Branch.ids.push(id);
  }

  createBranchClient(port) {
    return new branchToBranchPackage.BranchToBranch(
      `localhost:${port}`,
      grpc.credentials.createInsecure()
    );
  }

  async propagateChangeToOtherBranches(amount, action, customerRequestId) {
    const promises = [];
    for (let id of Branch.ids) {
      if (id === this.id) continue;
      const promise = new Promise(
        ((resolve, reject) => {
          const callback = (error, response) => {
            if (error) {
              reject(error);
            } else {
              resolve(response);
            }
          };
          const branchClient = this.createBranchClient(BASE_PORT + id);
          this.clock = this.clock + 1;
          this.events.push({
            "customer-request-id": customerRequestId,
            logical_clock: this.clock,
            interface: `propagate_${action}`,
            comment: `event_sent to branch ${id}`,
          });
          if (action === "deposit") {
            branchClient.propagateDeposit(
              {
                branchId: this.id,
                amount,
                clock: this.clock,
                customerRequestId,
              },
              callback
            );
          } else if (action === "withdraw") {
            branchClient.propagateWithdraw(
              {
                branchId: this.id,
                amount,
                clock: this.clock,
                customerRequestId,
              },
              callback
            );
          }
        }).bind(this)
      );
      promises.push(promise);
    }
    await Promise.all(promises);
  }

  query(_call, callback) {
    callback(null, { balance: this.balance, success: true });
  }

  async deposit(call, callback) {
    const { amount, clock, customerRequestId } = call.request;
    this.clock = Math.max(this.clock, clock) + 1;
    this.events.push({
      "customer-request-id": customerRequestId,
      logical_clock: this.clock,
      interface: "deposit",
      comment: `event_recv from customer ${this.id}`,
    });
    this.balance += amount;
    try {
      await this.propagateChangeToOtherBranches(
        amount,
        "deposit",
        customerRequestId
      );
      callback(null, { balance: this.balance, success: true });
    } catch (error) {
      callback(error);
    }
  }

  async withdraw(call, callback) {
    const { amount, clock, customerRequestId } = call.request;
    this.clock = Math.max(this.clock, clock) + 1;
    this.events.push({
      "customer-request-id": customerRequestId,
      logical_clock: this.clock,
      interface: "withdraw",
      comment: `event_recv from customer ${this.id}`,
    });
    try {
      if (this.balance - amount < 0) {
        return callback(new Error("Insufficient funds"), {
          balance: this.balance,
          success: false,
        });
      }

      // Propagate the change to other branches.
      await this.propagateChangeToOtherBranches(
        amount,
        "withdraw",
        customerRequestId
      );

      // Deduct the amount after successful propagation.
      this.balance -= amount;

      callback(null, { balance: this.balance, success: true });
    } catch (error) {
      callback(error);
    }
  }

  async propagateWithdraw(call, callback) {
    const { amount, clock, customerRequestId, branchId } = call.request;
    this.clock = Math.max(this.clock, clock) + 1;
    this.events.push({
      "customer-request-id": customerRequestId,
      logical_clock: this.clock,
      interface: "propagate_withdraw",
      comment: `event_recv from branch ${branchId}`,
    });
    if (this.balance - amount < 0) {
      callback(new Error("Insufficient funds"), { success: false });
    } else {
      this.balance -= amount;
      callback(null, { success: true });
    }
  }

  async propagateDeposit(call, callback) {
    const { amount, clock, customerRequestId, branchId } = call.request;
    this.clock = Math.max(this.clock, clock) + 1;
    this.events.push({
      "customer-request-id": customerRequestId,
      logical_clock: this.clock,
      interface: "propagate_deposit",
      comment: `event_recv from branch ${branchId}`,
    });
    this.balance += amount;
    callback(null, { success: true });
  }

  startServer(port) {
    const server = new grpc.Server();
    server.addService(branchToBranchPackage.BranchToBranch.service, {
      propagateWithdraw: this.propagateWithdraw.bind(this),
      propagateDeposit: this.propagateDeposit.bind(this),
    });
    server.addService(customerToBranchPackage.CustomerToBranch.service, {
      query: this.query.bind(this),
      deposit: this.deposit.bind(this),
      withdraw: this.withdraw.bind(this),
    });
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (error, port) => {
        if (error) {
          console.error(`Failed to bind server on port ${port}`, error);
        } else {
          server.start();
          Branch.servers.push(server);
          console.log(`Branch ${this.id} server started on port ${port}`);
        }
      }
    );
  }
}

module.exports = Branch;
