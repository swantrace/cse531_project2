const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const grpc = require("@grpc/grpc-js");
const Branch = require("./Branch");
const Customer = require("./Customer");
const { kill } = require("process");
// const INPUT_FILE_PATH = __dirname + "../input.json";
const INPUT_FILE_PATH = path.join(__dirname, "../input.json");
const BASE_PORT = process.env.BASE_PORT || 5000;

async function main() {
  // Remove the content of the output.txt file
  emptyOutputContent();

  // parse the input json
  const input = JSON.parse(fs.readFileSync(INPUT_FILE_PATH, "utf8"));

  // filter out and initialize the branches
  const branches = input.filter((entity) => entity.type === "branch");
  await initializeBranches(branches);

  // filter out and process the customers
  const customers = input.filter((entity) => entity.type === "customer");
  await processCustomers(customers);

  await shutdownServers();
}

async function shutdownServers() {
  for (const server of Branch.servers) {
    await new Promise((resolve, reject) => {
      server.tryShutdown((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

function emptyOutputContent() {
  try {
    fs.writeFileSync("output.txt", "", "utf8");
    console.log("File content removed successfully!");
  } catch (err) {
    console.error("Error writing to the file:", err);
  }
}

function sleep(ms) {
  // add ms millisecond timeout before promise resolution
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initializeBranches(branches) {
  for (const branchData of branches) {
    const branch = new Branch(branchData.id, branchData.balance);
    branch.startServer(BASE_PORT + branchData.id);
    await sleep(50);
  }
}

async function processCustomers(customers) {
  for (const customerData of customers) {
    const customer = new Customer(customerData.id);
    customer.createStub();
    const customerEvents = customerData.events.map((event) => ({
      ...event,
      branchId: customerData.id,
    }));
    customer.executeEvents(customerEvents);
    await sleep(200);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
