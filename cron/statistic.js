require('babel-polyfill')
const blockchain = require('../lib/blockchain')
const {exit, rpc} = require('../lib/cron')
const {forEachSeries} = require('p-iteration')
const locker = require('../lib/locker')
const util = require('./util')
// Models.
const Block = require('../model/block')
const Price = require('../model/price')
const Statistic = require('../model/statistic')
const TX = require('../model/tx')
const BetResult = require('../model/betresult')
const BetAction = require('../model/betaction')
const BetParlay = require('../model/betparlay')


console.log('Running statistic cron job');

/**
 * Process the blocks and transactions.
 * @param {Number} start The current starting block height.
 * @param {Number} stop The current block height at the tip of the chain.
 */
async function syncBlocksForStatistic (start, stop, clean = false) {
  if (stop - start > 1000) stop = start + 1000;
  if (clean) {
    await Statistic.deleteMany({ blockHeight: { $gte: start, $lte: stop } });
  }    
  
  const latest_statistic = await Statistic.findOne({height: { $lt: start}}).sort({blockHeight: -1});  

  let totalBet =  latest_statistic && latest_statistic.totalBet ? latest_statistic.totalBet : 0
  let totalMint =  latest_statistic && latest_statistic.totalMint ? latest_statistic.totalMint : 0
  let totalPayout =  latest_statistic && latest_statistic.totalPayout ? latest_statistic.totalPayout : 0
  let totalPayoutUSD =  latest_statistic && latest_statistic.totalPayoutUSD ? latest_statistic.totalPayoutUSD : 0

  const blocks = await Block.find({height: { $gte: start , $lte: stop}})

  const betData = await BetAction.aggregate([
    {$match: {blockHeight: { $gte: start , $lte: stop}}},
    { $group: { _id: "$blockHeight", total: { $sum: '$betValue' }, totalpayout: { $sum: '$payout' } } }
  ]);

  let betactionBetData = {};
  let betactionPayoutData = {}
  for (const item_bet_data of betData){
    betactionBetData[item_bet_data._id] = item_bet_data.total;
    if (item_bet_data.completed == true){
      betactionPayoutData[item_bet_data._id] = item_bet_data.totalpayout;
    }
  }



  const parlayData = await BetParlay.aggregate([
    {$match: {blockHeight: { $gte: start , $lte: stop}}},
    { $group: { _id: '$blockHeight', total: { $sum: '$betValue' }, totalpayout: { $sum: '$payout' } } }
  ]);

  let parlayBetData = {};
  let parlayPayoutData = {};
  for (const item_parlay_data of parlayData){
    parlayBetData[item_parlay_data._id] = item_parlay_data.total;
    if (item_parlay_data.completed == true){
      parlayPayoutData[item_parlay_data._id] = item_parlay_data.totalpayout;
    }
  }

  const resultDatas = await BetResult.aggregate([
    {$match: {blockHeight: { $gte: start , $lte: stop}}},
  ]);

  let resultPayoutDatas = {};
  for (const item_result of resultDatas){
    if (resultDatas[item_result.blockHeight]){
      resultPayoutDatas[item_result.blockHeight].push(item_result);
    } else {
      resultPayoutDatas[item_result.blockHeight] = [];
      resultPayoutDatas[item_result.blockHeight].push(item_result);
    }    
  }


  for (let block of blocks) {
    if (betactionBetData[block.height]){
      totalBet =+ betactionBetData[block.height]
    }

    if (parlayBetData[block.height]){
      totalBet =+ parlayBetData[block.height]
    }

    let resultData = resultPayoutDatas[block.height]
    if (resultData && resultData.length !== 0 ){
      resultData.forEach(queryResult => {
        let startIndex = 2
        let obj_checked = false;
        
        if (typeof queryResult.payoutTx !== "undefined" && typeof queryResult.payoutTx.vout !== "undefined"){
          if (queryResult.payoutTx.vout.length > 2){
            if (typeof queryResult.payoutTx.vout[1].address !== "undefined" && typeof queryResult.payoutTx.vout[2].address !== "undefined")
            {
              obj_checked = true;
            }
          }
        }
        if (obj_checked){
          if (queryResult.payoutTx.vout[1].address === queryResult.payoutTx.vout[2].address) {
            startIndex = 3
          }
        }
        for (let i = startIndex; i < queryResult.payoutTx.vout.length - 1; i++) {
          totalMint += queryResult.payoutTx.vout[i].value
        }
      })
    }

    try {
      let total_bet_wgr = 0;
      let total_bet_usd = 0;
      let total_parlay_wgr = 0;
      let total_parlay_usd = 0;

      const prices = await Price.aggregate([
        { $project: { diff: { $abs: { $subtract: [block.createdAt, '$createdAt'] } }, doc: '$$ROOT' } },
        { $sort: { diff: 1 } },
        { $limit: 1 }
      ]);
          
      if (betactionPayoutData[block.height]){
        total_bet_wgr = betactionPayoutData[block.height]
        total_bet_usd = total_bet_wgr * prices[0].doc.usd;
      }

      if (parlayPayoutData[block.height]){
        total_parlay_wgr = parlayPayoutData[block.height]
        total_parlay_usd = total_parlay_wgr * prices[0].doc.usd;
      }
        
      totalPayout =+ (total_bet_wgr + total_parlay_wgr);
      totalPayoutUSD =+ (total_bet_usd + total_parlay_usd);
      
    } catch(err) {
      console.log(err);
    }

    const statistic = new Statistic({
      blockHeight: block.height,
      createdAt: block.createdAt,
      totalBet: totalBet,
      totalMint: totalMint,
      totalPayout: totalPayout,
      totalPayoutUSD: totalPayoutUSD
    })
    await statistic.save()    
  }
  console.log('syncBlocksForStatistic', start, stop);
}

/**
 * Handle locking.
 */
async function update () {
  const type = 'statistic'
  let code = 0

  try {
    const statistic = await Statistic.findOne().sort({blockHeight: -1})
    const betResult = await BetResult.findOne().sort({blockHeight: -1})

    let clean = true // Always clear for now.
    let dbStatisticHeight =  statistic && statistic.blockHeight ? statistic.blockHeight : 10000

    let startHeight = dbStatisticHeight

    const block = await Block.findOne().sort({ height: -1});
    let blockDbHeight = block && block.height ? block.height - 1: 1;
    let dbResultHeight =  betResult && betResult.blockHeight ? betResult.blockHeight : 1

    let stopHeight = [blockDbHeight,  dbResultHeight].sort().reverse()[0]

    // If heights provided then use them instead.
    if (!isNaN(process.argv[2])) {
      clean = true
      startHeight = parseInt(process.argv[2], 10)
    }
    if (!isNaN(process.argv[3])) {
      clean = true
      stopHeight = parseInt(process.argv[3], 10)
    }
    console.log(startHeight, stopHeight, clean)
    // If nothing to do then exit.
    if (startHeight >= stopHeight) {
      return
    }
    // If starting from genesis skip.
    else if (startHeight === 0) {
      startHeight = 10000
    }

    locker.lock(type)
    await syncBlocksForStatistic(startHeight, stopHeight, clean)
  } catch (err) {
    console.log(err)
    code = 1
  } finally {
    try {
      locker.unlock(type)
    } catch (err) {
      console.log(err)
      code = 1
    }
    exit(code)
  }
}

update()
