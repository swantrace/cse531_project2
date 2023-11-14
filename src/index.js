const fs = require("fs");
const path = require("path");
const Branch = require("./Branch");
const Customer = require("./Customer");
const INPUT_FILE_PATH = path.join(__dirname, "../input.json");
const OUTPUT_FILE_PATH = path.join(__dirname, "../output.txt");
const OUTPUT_TEMPLATE_PATH = path.join(__dirname, "../output.template.txt");
const CUSTOMER_EVENTS_PATH = path.join(__dirname, "../output.customer.json");
const BRANCH_EVENTS_PATH = path.join(__dirname, "../output.branch.json");
const CUSTOMER_REQUEST_EVENTS_PATH = path.join(
  __dirname,
  "../output.customer_request.json"
);
const BASE_PORT = process.env.BASE_PORT || 5000;

async function main() {
  // Remove the content of the output.txt file
  emptyOutputContent();

  // parse the input json
  const input = JSON.parse(fs.readFileSync(INPUT_FILE_PATH, "utf8"));

  // filter out and initialize the branches
  const branches = input.filter((entity) => entity.type === "branch");

  // initialize the branches
  const branchItems = await initializeBranches(branches);

  // filter out and process the customers
  const customers = input.filter((entity) => entity.type === "customer");

  // process customer events
  const customerItems = await processCustomers(customers);

  // write the output to the file
  writeJSONFiles(branchItems, customerItems);
  combineJSONFiles();

  // shutdown the servers
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
    fs.writeFileSync(OUTPUT_FILE_PATH, "", "utf8");
    fs.writeFileSync(CUSTOMER_EVENTS_PATH, "", "utf8");
    fs.writeFileSync(BRANCH_EVENTS_PATH, "", "utf8");
    fs.writeFileSync(CUSTOMER_REQUEST_EVENTS_PATH, "", "utf8");
    console.log("File content removed successfully!");
  } catch (err) {
    console.error("Error writing to the file:", err);
  }
}

function sleep(ms) {
  // add ms millisecond timeout before promise resolution
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJSONFiles(brancheItems, customerItems) {
  // write customer events to file
  const customerEvents = customerItems.map(({ id, events }) => ({
    id,
    type: "customer",
    events,
  }));
  fs.writeFileSync(
    CUSTOMER_EVENTS_PATH,
    JSON.stringify(customerEvents, null, 2),
    "utf8"
  );
  // write branch events to file
  const branchEvents = brancheItems.map(({ id, events }) => ({
    id,
    type: "branch",
    events,
  }));
  fs.writeFileSync(
    BRANCH_EVENTS_PATH,
    JSON.stringify(branchEvents, null, 2),
    "utf8"
  );
  // write customer request events to file
  const customerRequestEvents = [...customerEvents, ...branchEvents]
    .flatMap(({ events, id, type }) =>
      events.map((event) => ({
        id,
        "customer-request-id": event["customer-request-id"],
        type,
        logical_clock: event["logical_clock"],
        interface: event.interface,
        comment: event.comment,
      }))
    )
    .sort(
      (a, b) =>
        a["customer-request-id"] - b["customer-request-id"] ||
        a.logical_clock - b.logical_clock
    );
  fs.writeFileSync(
    CUSTOMER_REQUEST_EVENTS_PATH,
    JSON.stringify(customerRequestEvents, null, 2),
    "utf8"
  );
}

function combineJSONFiles() {
  try {
    const template = fs.readFileSync(OUTPUT_TEMPLATE_PATH, "utf8");
    const customerEvents = fs.readFileSync(CUSTOMER_EVENTS_PATH, "utf8");
    const branchEvents = fs.readFileSync(BRANCH_EVENTS_PATH, "utf8");
    const customerRequestEvents = fs.readFileSync(
      CUSTOMER_REQUEST_EVENTS_PATH,
      "utf8"
    );
    const content = template
      .replace("{{ customer_events }}", customerEvents)
      .replace("{{ branch_events }}", branchEvents)
      .replace("{{ customer_request_events }}", customerRequestEvents);
    fs.writeFileSync(OUTPUT_FILE_PATH, content, "utf8");
    console.log("File content written successfully!");
  } catch (err) {
    console.error("Error writing to the file:", err);
  }
}

async function initializeBranches(branches) {
  const branchItems = [];
  for (const branchData of branches) {
    const branch = new Branch(branchData.id, branchData.balance);
    branchItems.push(branch);
    branch.startServer(BASE_PORT + branchData.id);
    await sleep(50);
  }
  return branchItems;
}

async function processCustomers(customers) {
  const customerItems = [];
  const promises = [];
  for (const customerData of customers) {
    const customer = new Customer(customerData.id);
    customer.createStub();
    customerItems.push(customer);
    const customerEvents = customerData["customer-requests"].map((event) => ({
      ...event,
      branchId: customerData.id,
    }));
    promises.push(customer.executeEvents(customerEvents));
  }
  await Promise.all(promises);
  return customerItems;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
