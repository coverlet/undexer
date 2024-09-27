import { writeFile } from "node:fs/promises";

export function waitFor (msec) {
  return new Promise(resolve=>setTimeout(resolve, msec))
}

export function waitForever () {
  return new Promise(_=>console.warn('Debug mode. Pausing until manual intervention.'))
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
      const result = await Promise.resolve(callback())
      return result
    } catch (e) {
      console.error(e)
      console.info('Retrying in', interval, 'msec')
      await waitFor(interval)
    }
  }
}

/** Run up to `max` tasks in parallel. */
export async function runParallel ({ max, process, inputs }) {
  inputs = [...inputs]
  let nextIndex = 0
  const results = []
  const pile = new Set()
  while ((inputs.length > 0) || (pile.size > 0)) {
    while ((pile.size < max) && (inputs.length > 0)) {
      const index = nextIndex
      nextIndex++
      const task = process(inputs.shift()).then(result=>results[index]=result)
      pile.add(task)
      task.finally(()=>pile.delete(task))
    }
    await Promise.race([...pile])
  }
  return results
}

export function maxBigInt (x, y) {
  x = BigInt(x)
  y = BigInt(y)
  return (x > y) ? x : y
}

export function pad (x) {
  return String(x).padEnd(10)
}
