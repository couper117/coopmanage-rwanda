import { disconnectPrisma, prisma } from '../lib/prisma.js'
import { rebuildStockLevels } from '../modules/inventory/rebuild.js'

/**
 * `npm run inventory:rebuild [-- --apply]`
 *
 * `StockLevel` is a running balance and a cache of the movement history. Everything reads it, so
 * it has to be right; this is how somebody checks that it is, and puts it back when it is not.
 *
 * Run it after a restore, after a migration that touched these tables, or whenever a figure is in
 * doubt. Without `--apply` it only reports, which is the default on purpose: finding out that a
 * level is wrong matters more than the number, and a command that silently corrected a
 * discrepancy would destroy the evidence of whatever caused it.
 */
const apply = process.argv.includes('--apply')

/* This is a command whose entire output is what it prints. */
/* eslint-disable no-console */

try {
  const cooperatives = await prisma.cooperative.findMany({
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
  })

  let checked = 0
  let wrong = 0

  for (const cooperative of cooperatives) {
    const report = await rebuildStockLevels(cooperative.id, { apply })
    if (report.pairs === 0) continue
    checked += 1

    if (report.agrees) {
      console.log(`${cooperative.code}: ${report.pairs} levels, all agree with the history`)
      continue
    }

    wrong += 1
    console.log(
      `${cooperative.code}: ${report.differences.length} of ${report.pairs} levels disagree`,
    )
    for (const difference of report.differences) {
      const where = difference.warehouseName || difference.warehouseId
      const what = difference.sku || difference.productId
      console.log(
        `  ${what} in ${where}: stored ${difference.stored}, history says ${difference.computed}`,
      )
    }
    if (apply) console.log('  corrected')
  }

  if (checked === 0) {
    console.log('no cooperative has any stock movements yet')
  } else if (wrong === 0) {
    console.log(`\n${checked} cooperatives checked, every level agrees with its history`)
  } else if (!apply) {
    console.log(
      `\n${wrong} cooperatives have levels that disagree. Re-run with --apply to correct them.`,
    )
    process.exitCode = 1
  }
} finally {
  await disconnectPrisma()
}
