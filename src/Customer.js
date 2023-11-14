const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
const fs = require("fs");
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

const customerToBranchPackage = grpc.loadPackageDefinition(
  CUSTOMER_TO_BRANCH_PACKAGE_DEFINITION
).customertobranch;

const BASE_PORT = process.env.BASE_PORT || 5000;

class Customer {
  constructor(id) {
    this.id = id;
    this.clock = 0;
    this.events = [];
    this.balance = 0;
  }

  createStub() {
    this.stub = new customerToBranchPackage.CustomerToBranch(
      `localhost:${BASE_PORT + this.id}`,
      grpc.credentials.createInsecure()
    );
  }

  async executeEvents(events = []) {
    for (const event of events) {
      const { branchId, money } = event;
      const customerRequestId = event["customer-request-id"];
      this.clock = this.clock + 1;
      this.events.push({
        "customer-request-id": customerRequestId,
        logical_clock: this.clock,
        interface: event.interface,
        comment: `event_sent from customer ${this.id}`,
      });
      try {
        let res;
        switch (event.interface) {
          case "deposit":
            res = await this.deposit(branchId, money, customerRequestId);
            break;
          case "withdraw":
            res = await this.withdraw(branchId, money, customerRequestId);
            break;
          case "query":
            res = await this.query(branchId, customerRequestId);
            break;
          default:
            console.error(`Unknown event interface: ${event.interface}`);
        }
        this.balance = res.balance;
      } catch (error) {
        console.error(error);
      }
    }
  }

  deposit(branchId, amount, customerRequestId) {
    return new Promise((resolve, reject) => {
      // to do: pass correct clock value
      this.stub.deposit(
        { branchId, amount, clock: this.clock, customerRequestId },
        (error, response) => {
          if (error) {
            console.error(
              `Deposit error for Customer ${this.id} to Branch ${branchId}: ${error.message}`
            );
            reject(error);
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  withdraw(branchId, amount, customerRequestId) {
    return new Promise((resolve, reject) => {
      // to do: pass correct clock value
      this.stub.withdraw(
        { branchId, amount, clock: this.clock, customerRequestId },
        (error, response) => {
          if (error) {
            console.error(
              `Withdraw error for Customer ${this.id} to Branch ${branchId}: ${error.message}`
            );
            reject(error);
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  query(branchId, customerRequestId) {
    return new Promise((resolve, reject) => {
      // to do: pass correct clock value
      this.stub.query(
        { branchId, clock: this.clock, customerRequestId },
        (error, response) => {
          if (error) {
            console.error(
              `Query error for Customer ${this.id} on Branch ${branchId}: ${error.message}`
            );
            reject(error);
          } else {
            console.log(
              `Customer ${this.id} queried balance on Branch ${branchId}. Balance: ${response.balance}`
            );
            resolve(response);
          }
        }
      );
    });
  }
}

module.exports = Customer;
