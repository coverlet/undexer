import { writeFile } from "node:fs/promises";
import { base64 } from "@hackbg/fadroma";

export function waitFor (msec) {
  return new Promise(resolve=>setTimeout(resolve, msec))
}

export async function runForever (interval, callback) {
  while (true) {
    try {
      await Promise.resolve(callback())
    } catch (e) {
      console.error(e)
    }
    await waitFor(interval)
  }
}

export async function retryForever (interval, callback) {
  while (true) {
    try {
      await Promise.resolve(callback())
      break
    } catch (e) {
      console.error(e)
      console.info('Retrying in', interval, 'msec')
      await waitFor(interval)
    }
  }
}

/** Run up to `max` tasks in parallel. */
export async function runParallel ({ max, process, inputs }) {
  const pile = new Set()
  while ((inputs.length > 0) || (pile.size > 0)) {
    while ((pile.size < max) && (inputs.length > 0)) {
      const task = process(inputs.shift())
      pile.add(task)
      task.finally(()=>pile.delete(task))
    }
    await Promise.race([...pile])
  }
}

export function pad (x) {
  return String(x).padEnd(10)
}

export function cleanup (data) {
  return JSON.parse(serialize(data))
}

export function serialize (data) {
  return JSON.stringify(data, stringifier);
}

export function stringifier (key, value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return base64.encode(value);
  }
  return value;
}

export async function save (path, data) {
  console.log("Writing", path);
  return await writeFile(path, serialize(data));
}
