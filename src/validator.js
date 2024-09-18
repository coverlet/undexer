import * as Namada from "@fadroma/namada";
import { base16 } from "@hackbg/fadroma";
import { Validator } from "./db.js";
const console = new Namada.Console(`Validators`);

export async function tryUpdateValidators(chain, height) {
  try {
    const { count, added, updated } = await updateValidators(chain, height);
    console.log(`=> ${count} validators (added ${added}, updated ${updated})`);
  } catch (e) {
    console.error("Failed to update validators.");
    console.error(e);
  }
}

export async function tryUpdateConsensusValidators(chain, height) {
  try {
    const {count, added, updated } = await updateConsensusValidators(chain, height);
    console.log(`=> ${count} consensus validators (added ${added}, updated ${updated})`);
  } catch (e) {
    console.error("Failed to update validators.");
    console.error(e);
  }
}

export async function updateConsensusValidators(chain, height) {
  console.log("=> Updating known consensus validators");
  // Update the current known Consenus list first
  const consensusListLocal = (await Validator.findAll({
    where: { state: { state: "Consensus" } }, attributes: ["namadaAddress"],
  })).map((x) => x.toJSON().namadaAddress)
  const consensusListOnChain = (await chain.fetchValidatorsConsensus()).map(x=>x.address)
  const consensusAddresses = [...new Set([...consensusListLocal, ...consensusListOnChain])]
  return updateValidators(chain, height, consensusAddresses)
}

export async function updateValidators(chain, height, addresses) {
  console.log("=> Updating validators");
  let count = 0;
  let added = 0;
  let updated = 0;
  for await (const validator of chain.fetchValidatorsIter({
    parallel: true,
    addresses,
  })) {
    try {
      const existing = await Validator.findOne({
        where: { namadaAddress: validator.namadaAddress },
      });
      if (existing) {
        console.log("Updating validator", JSON.stringify(validator, (k, v) => {
          return (typeof v === 'bigint') ? String(v) : v
        }));
        existing.publicKey = validator.publicKey;
        existing.pastPublicKeys = [
          ...new Set(
            [...(existing.pastPublicKeys || []), validator.publicKey].filter(
              Boolean
            )
          ),
        ];
        existing.consensusAddress = validator.address;
        existing.pastConsensusAddresses = [
          ...new Set(
            [
              ...(existing.pastConsensusAddresses || []),
              validator.address,
            ].filter(Boolean)
          ),
        ];
        existing.votingPower = validator.votingPower;
        existing.proposerPriority = validator.proposerPriority;
        existing.metadata = validator.metadata;
        existing.commission = validator.commission;
        existing.stake = validator.stake;
        existing.state = validator.state;
        await existing.save();
        updated++;
      } else {
        console.log("Adding validator", validator.namadaAddress);
        await Validator.create(validator);
        added++;
      }
      count++;
    } catch (error) {
      console.log(error);
    }
  }
  return { count, added, updated }
}
