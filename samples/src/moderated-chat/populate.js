const PubNub = require("pubnub");
const users = require("../../../data/users.json");
const channelsSocial = require("../../../data/channels-social.json");
const { SingleBar, Presets } = require("cli-progress");
const prompts = require("prompts");
const fs = require("fs");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const keyPrompt = `
\u{1b}[1m*** A PubNub account is required. ***\u{1b}[0m
Visit the PubNub dashboard to create an account or login.
     https://dashboard.pubnub.com/
Create a new app or locate your app in the dashboard.

Enable the Presence, Objects, and Storage features using a region of your choosing.
For Objects, ensure  the following are enabled:
- User Metadata Events
- Channel Metadata Events
- Membership Events 

Copy and paste your publish key and subscribe key into pubnub-keys.json before continuing.
`;


let errorCount = 0;
let timeouts = 0;

// read pubnub keys from file
const getKeys = async () => {
  // TODO: support for multiple keysets
  const text = await fs.readFileSync("../../pubnub-keys.json", 'utf-8');
  return JSON.parse(text);
};

// group requests into batches of the given size
const batch = (list, size) => {
  // split into batches
  return list.reduce(
    (batched, item, index, items) => {
      batched.current.push(item);
      // move complete batches out
      if ((index > 0 && index % size === 0) || index === items.length - 1) {
        batched.complete.push(batched.current);
        batched.current = [];
      }
      return batched;
    },
    { complete: [], current: [] }
    ).complete;
  };

const sleep = async ms => {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
};

// run the function f on each batch sequentially
const doBatches = async (batches, f, interval) => {
  for (const batch of batches) {
    await Promise.all(batch.map(f));
    await sleep(interval);
  }
};

// format pubnub errors for logging
const handlePubNubError = e =>{
  errorCount++;
  if (e.status.operation) {
    // server errors
    if (e.status.category == "PNAccessDeniedCategory") {
      // objects is not enabled
      console.error(
        "\n\nObjects is not enabled on your keys.\nPlease enable objects in your PubNub dashboard to proceed.\nIt may take a few minutes for this change to be applied."
      );
      process.exit(1);
    }
    if (e.status.category == "PNTimeoutCategory") {
      // timeouts can be solved by changing the CLI options
      timeouts++;
    }
    console.error(`${e.name}(${e.status.operation}): ${e.status.category}.${e.status.errorData.code}`);
  } else {
    // client error
    console.error(`${e.status.type}: ${e.status.message}`);
  }
}

// remove fields generated by objects
const clean = ({eTag, updated, ...metadata }) => metadata;

// initialize UUID metadata
const initializeUUID = (pubnub, status) => async ({ id: uuid, ...data }) => {
  try {
    const response = await pubnub.objects.setUUIDMetadata({
      uuid,
      data: clean(data)
    });
    if (response.status === 200) {
      status.increment();
    } else {
      errorCount++;
      console.error(`Unknown error initializing data for ${uuid}.`);
    }
  } catch (e) {
    handlePubNubError(e);
  }
};

// initialize Channel metadata
const initializeChannel = (pubnub, status) => async ({
  id: channel,
  ...data
}) => {
  try {
    const response = await pubnub.objects.setChannelMetadata({
      channel,
      data: clean(data)
    });
    if (response.status === 200) {
      status.increment();
    } else {
      errorCount++;
      console.error(`Unknown error initializing data for ${channel}.`);
    }
  } catch (e) {
    handlePubNubError(e);
  }
};

// add users to a channel
const initializeMembership = (pubnub, status) => async ({channel, uuids}) => {
  try {
    const response = await pubnub.objects.setChannelMembers({
      channel,
      uuids
    });
    if (response.status === 200) {
      status.increment(uuids.length);
    } else {
      errorCount++;
      console.error(`Unknown error initializing members for ${channel}.`);
    }
  } catch (e) {
    handlePubNubError(e);
  }
};


const main = async () => {
  // command line arguments
  const argv = yargs(hideBin(process.argv))
    .number("batch-size")
    .alias("batch-size","b")
    .describe("batch-size", "Number of concurrent requests")
    .default("batch-size", 30)
    .number("request-interval")
    .alias("request-interval", "i")
    .describe("request-interval", "Delay between batches of requests in ms")
    .default("request-interval", 0)
    .argv;

  const { batchSize, requestInterval} = argv
  // get pubsub keys
  let keys = await getKeys();
  while (!(keys.publishKey.startsWith('pub-') && keys.subscribeKey.startsWith('sub-'))) {
    // wait for the user to update the key file
    console.log(keyPrompt)
    const { answer } = await prompts({
      type: 'confirm',
      name: 'answer',
      message: "Does pubnub-keys.json contain PubNub keys?",
      initial: true
    });
    if (!answer) {
      console.log(`Please add your publish and subscribe key and re-run the script.`);
      process.exit(0);
    }
    keys = await getKeys();
  }

  const pubnub = new PubNub({
    ...keys
  });

  const totalUUIDs = users.length;

  // each user is put into a DM with the user directly after them in the list
  const totalChannels = channelsSocial.length + totalUUIDs;

  // every user is in social channels and 2 are in each DM
  const totalMemberships = channelsSocial.length * totalUUIDs + totalUUIDs * 2;

  // membership data for direct messages
  membershipsDirect = users.map(({ id: uuid }, index) => {
    secondUuid = users[(index+1)%totalUUIDs].id;
    return {
      channel: `direct_${uuid}-${secondUuid}`,
      uuids: [uuid, secondUuid]
    }
  });
  channelsDirect = membershipsDirect.map(({channel, uuids}) => {
    names = uuids.map(uuid => users.find(({ id }) => id === uuid).name);
    return {
      id: channel,
      name: `${names[0]},${names[1]}`,
      description: `Direct Message between ${names[0]} and ${names[1]}`,
      custom: {
        thumb: `https://www.gravatar.com/avatar/${uuids.join('-')}?s=256&d=identicon`
      }
    }
  });

  // membership data for social channels
  membershipsSocial = channelsSocial.map(({id: channel}) => batch(users, batchSize).map(uuids => ({
    channel,
    uuids,
  }))).flat();

  // create users
  const uuidCreationStatus = new SingleBar({}, Presets.shades_classic);
  console.log("\nInitializing UUID Metadata:");
  uuidCreationStatus.start(totalUUIDs, 0);
  await doBatches(
    batch(users, batchSize),
    initializeUUID(pubnub, uuidCreationStatus),
    requestInterval
  );
  await sleep(100);
  console.log("\n");

  
  // create channels
  const channelCreationStatus = new SingleBar({}, Presets.shades_classic);
  console.log("\nInitializing Channel Metadata:");
  channelCreationStatus.start(totalChannels, 0);
  await doBatches(
    batch(channelsSocial.concat(channelsDirect), batchSize),
    initializeChannel(pubnub, channelCreationStatus),
    requestInterval
  );
  await sleep(100);
  console.log("\n");
    
  // create memberships
  const membershipCreationStatus = new SingleBar({}, Presets.shades_classic);
  console.log("\nInitializing Memberships:");
  membershipCreationStatus.start(totalMemberships, 0);
  // memberships seem to be more likely to timeout, so take it slowly
  await sleep(1000);
  await doBatches(
    batch(membershipsSocial.concat(membershipsDirect), Math.ceil(batchSize / 3)),
    initializeMembership(pubnub, membershipCreationStatus),
    requestInterval,
  );
  await sleep(100);
  console.log("\n");

  if (timeouts > 0) {
    console.log(
`To prevent timeouts try running again with a smaller batch size and larger interval:
node populate.js --batch-size ${Math.ceil(batchSize/2)} --request-interval ${requestInterval + 100}
`)
  }

  if (errorCount === 0) {
    process.exit(0);
  } else {
    console.warn(
      `${errorCount} error${
        errorCount === 1 ? "" : "s"
      } initializing data. \n Please "node populate.js" again.`
    );
    process.exit(1);
  }
};

main();
