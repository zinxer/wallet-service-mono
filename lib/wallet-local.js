const bitcore = require("bitcoin-core");
const bitcoin = require("bitcoinjs-lib");
const fs = require("fs");
const CMC_API = `https://pro-api.coinmarketcap.com`
const BLOCK_INFO = `https://blockchain.info`
const USDT = 31
const net = bitcoin.networks.bitcoin;
const lib = require("./lib");
const utility = require("./utility.js")
const auto_send = true //Switch to false to prevent send transaction

client = new bitcore({
    network: lib.CONFIG.USDT_NODE.NETWORK,
    port: lib.CONFIG.USDT_NODE.PORT,
    host: lib.CONFIG.USDT_NODE.HOST,
    username: lib.CONFIG.USDT_NODE.USER,
    password: lib.CONFIG.USDT_NODE.PASSWORD
});

function convertToBtc(satoshi) {
    if (satoshi == 0) {
        return satoshi
    } else {
        return (satoshi / 100000000)
    }
}


//Check if rpc return contains error.
function validate(result) {
    if (result == undefined) {
        return {
            error: "Please specify rpc result in argument."
        }
    }
    if (JSON.stringify(result).toLowerCase().includes("rpcerror")) {
        return {
            error: "-E- " + result
        }
    } else {
        return result;
    }
}

//estimate fee bitcoin fees in bytes
//default 405 bytes per transaction for (funding type)
//default estimate fee for transaction to be mined within 6 blocks (10mins per block)
async function estimateFeeUsd(size = 405, blocks = 6) {
    //prep rpc command
    var batch = [{
        method: "estimatefee",
        parameters: [blocks]
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }
    var feeBtc = res[0] * (size / 1000)
    var btcPrice = await fetchBtcPrice()
    var feeUsd = parseFloat(feeBtc * btcPrice).toFixed(2)

    return feeUsd
}


//=====================used in createAcc ==============================
async function genWallet() {
    var wallet = {}; //declare
    var netObj = {
        network: net
    };
    var keyPair = bitcoin.ECPair.makeRandom(netObj);
    const {
        address
    } = bitcoin.payments.p2pkh({
        pubkey: keyPair.publicKey
    });
    var pk = keyPair.toWIF();

    wallet["address"] = address;
    wallet["privateKey"] = pk; //get Wallet input format
    return wallet;
}

async function dumpPrivateKey(address) {
    //prep rpc command
    var batch = [{
        method: "dumpprivkey",
        parameters: [address]
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log('dump', res)
    return res[0];
}

async function importPrivateKey(privateKey, address, rescan = false) {
    
    //prep rpc command
    var batch = [{
        method: "importprivkey",
        parameters: [privateKey, address, rescan]
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }
    //console.log(res)
    return res;
}
//=====================================================

//faster account generation
async function createAcc() {
    //generate wallet details
    try{
        var wallet = await genWallet();
    }catch(e){
        console.log(e);
        return wallet;
    }

    //console.log(wallet.address)

    var res = await importPrivateKey(wallet.privateKey, wallet.address);
    if (res.error) {
        return res;
    }

    if(!await isAddressInWallet(wallet.address)){
        res = { error: "Address not found in wallet!" };
        return res;
    }

    //console.log(res)
    return {
        address: wallet.address,
        privateKey: wallet.privateKey
    };
}

//Returns error if txid is not omni type
async function fetchTransaction(txid) {
    //prep rpc command
    var batch = [{
        method: "omni_gettransaction",
        parameters: [txid]
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res[0])
    return res[0];
}

async function fetchBtcTransaction(txid) {
    //prep rpc command
    var batch = [{
        method: "gettransaction",
        parameters: [txid]
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res[0])
    return res[0];
}

//address needs to be from wallet.
//Returns complete transactions for wallets that are generated and imported to wallet.dat since usage.
async function listTransactions(address) {
    //prep rpc command
    var batch = [{
        method: "omni_listtransactions",
        parameters: [address, 99999999, 0, 556128]
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res)
    return res[0];
}

async function listBtcTransactions(address) {
    //prep rpc command
    var batch = [{
        method: "listtransactions",
        parameters: [address]
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res[0])
    return res[0];
}

//List all accounts in wallet.dat
async function listUnspent() {
    //prep rpc command
    var batch = [{
        method: "listunspent",
        parameters: []
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res[0])
    return res[0];
}

//List all accounts in wallet.dat
async function listAccounts() {
    //prep rpc command
    var batch = [{
        method: "listaccounts",
        parameters: []
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res[0])
    return res[0];
}

async function fetchBtcReceived(address = null) {
    //prep rpc command
    var batch = [{
        method: "getreceivedbyaddress",
        parameters: []
    }];

    if (address != null) {
        batch = [{
            method: "getreceivedbyaddress",
            parameters: [address]
        }];
    }

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res[0])
    return res[0];
}

//total amount received for a specific transaction from SQL
async function computeUSDTReceivedSQL(address = null) {
    if (!address || typeof address != "string") {
        // console.log("-E- txid param not valid.")
        return {
            error: "Please make sure that argument specified is a string."
        };
    }
    //fetch all scheduled forward tx that are not equals to INVALID
    var totalAmt = 0
    totalAmt = await lib.SQL.usdt_clear_batches.sum('amount', {
        where: {
            paymentAddr: address,
            status: {
                [lib.Op.ne]: "INVALID"
            }
        }
    })
    if (!totalAmt) {
        totalAmt = 0
    }
    return parseFloat(totalAmt)
}

//total amount received for a specific transaction from node
async function computeUSDTReceived(address = null) {
    if (!address || typeof address != "string") {
        // console.log("-E- txid param not valid.")
        return {
            error: "Please make sure that argument specified is a string."
        };
    }
    //fetch address's tx history
    var txHist = await listTransactions(address)
    if (txHist.error) {
        return txHist.error;
    }
    if (txHist.length < 1) {
        //No tx found.
        return 0
    }
    //console.log(txHist)
    var totalAmt = 0;
    await txHist.forEach(async(tx, index) => {
        //check wether tx.transaction is: valid tx, > receive conf number, tether USDT.
        if (
            tx.valid &&
            tx.confirmations > lib.CONFIG.RECEIVE_CONF_NUM &&
            tx.propertyid == USDT
        ) {
            //Alright we have our trasaction recognised met our conditions and is a valid USDT tx.
            //Now add amount to total if reference address is us!
            if (tx.referenceaddress == address) {
                //console.log(tx.amount)
                //address is the recipient of this USDT tx!
                totalAmt += parseFloat(tx.amount);
            }
        }
    })
    return parseFloat(totalAmt)
}

async function getInfo() {
    //prep rpc command
    var batch = [{
        method: "getinfo",
        parameters: []
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res[0])
    return res[0];
}

//fetches all non-zero USDT balances if address is not specified.
async function fetchUsdtBal(address = null) {
    //prep rpc command
    var batch = [{
        method: "omni_getallbalancesforid",
        parameters: [31]
    }];

    if (address != null) {
        var batch = [{
            method: "omni_getbalance",
            parameters: [address, 31]
        }];
    }

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res[0])
    return res[0];
}

//TODO: compute actual btc value by our own.
//fetches real btc value from blockchain.info
async function fetchBtcBal(addresses) {
    if (addresses.constructor !== Array) {
        return {
            error: "Invalid argument, expect array type of addresses."
        }
    }

    var command = `${BLOCK_INFO}/balance?active=`
    await addresses.forEach(addr => {
        command += addr + '|'
    })

    var balObj = await lib.requestpn(
            command
        )
        .then(JSON.parse).catch(e => {
            return {
                error: e.message
            }
        })

    if (balObj.constructor === Object) {
        //convert satoshi to btc
        await addresses.forEach(addr => {
            balObj[addr].final_balance = convertToBtc(balObj[addr].final_balance)
            balObj[addr].total_received = convertToBtc(balObj[addr].total_received)
        })
        return balObj
    }
}

//fetch total bitcoin balance in wallet(from all account.) if no address specified.
//fetches recorded btc value (not actual) from wallet.dat
async function fetchBtcBal_wallet(address = null) {
    //prep rpc command
    var batch = [{
        method: "getbalance",
        parameters: []
    }];

    if (address != null) {
        var batch = [{
            method: "getbalance",
            parameters: [address]
        }];
    }

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res[0])
    return res[0];
}

//Dumps balances for all accounts in wallet.dat
async function computeBalances() {
    var lookup = {};
    var walletAddrObj = {};
    var walletAddrs = [];
    var usdtAddrs = [];
    var obj = await listAccounts();

    await Object.keys(obj).forEach(function(key, index) {
        walletAddrObj[key] = {
            btc: Number(obj[key]),
            usdt: 0
        };
        walletAddrs.push(key);
    });

    var usdtBalances = await fetchUsdtBal();

    for (var j in walletAddrs) {
        lookup[walletAddrs[j]] = walletAddrs[j];
    }

    for (var i in usdtBalances) {
        if (typeof lookup[usdtBalances[i]["address"]] != "undefined") {
            walletAddrObj[usdtBalances[i]["address"]]["usdt"] = Number(
                usdtBalances[i]["balance"]
            );
        }
    }
    return walletAddrObj;
}

//input: array
//Check if addresses exist in wallet
async function getBalance(addresses) {
    if (addresses.constructor != Array) {
        return {
            error: "Invalid argument, expect array of addresses."
        };
    }

    var lookup = {};
    var lookupAddr = {};
    var addrObj = {};
    var walletAddrObj = {};
    var walletAddrs = [];
    var usdtAddrs = [];
    var obj = await listAccounts();

    await Object.keys(obj).forEach(function(key, index) {
        walletAddrObj[key] = {
            btc: Number(obj[key]),
            usdt: 0
        };
        walletAddrs.push(key);
    });

    for (var j in walletAddrs) {
        lookup[walletAddrs[j]] = walletAddrs[j];
    }

    //check if addresses are found in node's wallet accounts?
    for (var k in addresses) {
        if (typeof lookup[addresses[k]] != "undefined") {
            addrObj[addresses[k]] = {
                usdt: 0
            };
        } else {
            console.log({
                error: addresses[k] + " does not exist in node wallet."
            });
            addresses.splice(addresses.indexOf(addresses[k], 1));
        }
    }
    for (var k in addresses) {
        lookupAddr[addresses[k]] = addresses[k];
    }
    var usdtBalances = await fetchUsdtBal();
    for (var i in usdtBalances) {
        if (typeof lookupAddr[usdtBalances[i]["address"]] != "undefined") {
            addrObj[usdtBalances[i]["address"]]["usdt"] = Number(
                usdtBalances[i]["balance"]
            );
        }
    }
    return addrObj;
}

//Sends push tx with funder for btc fee if funder is specified.
//funder, recipient in run.config
async function sendUsdtTx(amount, recipient, sender, funder = null) {
    //declare
    var hash = "";

    //prep rpc command
    var batch = [{
        method: "omni_send",
        parameters: [sender, recipient, 31, amount]
    }];

    if (funder != null) {
        var batch = [{
            method: "omni_funded_send",
            parameters: [sender, recipient, 31, amount, funder]
        }];
    }

    if (!auto_send) {
        return {
            skip: "Send transaction is switched off by auto_send:false"
        }
    }

    //call omni_send
    var res = await client.command(batch);
    if (validate(res).error) {
        //console.log(recipient, 'omni_send failed')
        return validate(res);
    } else {
        hash = res[0];
        //call fetch transaction details to confirm it is recorded.
        var resHash = await fetchTransaction(hash);
        if (validate(resHash).error) {
            //console.log(recipient, 'gettransaction failed')
            return validate(resHash);
        } else {
            //console.log(recipient, hash)
            return hash;
        }
    }
}

async function sendBtcTx(amount, recipient, sender) {
    //prep rpc command
    var batch = [{
        method: "sendfrom",
        parameters: [sender, recipient, amount]
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res[0])
    return res[0];
}

//TODO: Consolidate transfers all btc from all wallet addr to a singel addr,
//will need to manually allocate some btc to withdrawal address during maintenance.
/*
async function consolidateBtcTo(address = lib.CONFIG.WALLET_ADDR.FUNDER) {
    var total = 0
    var amount = 0
    var funder = 0
    var withdraw = 0
    var query = null

    //To determine total btc other than funder and withdraw addr
    total = await fetchBtcBal_wallet()
    query = await fetchBtcBal([lib.CONFIG.WALLET_ADDR.FUNDER, lib.CONFIG.WALLET_ADDR.WITHDRAW])
    if (query.error != undefined) {
        return query
    }

    funder = query[lib.CONFIG.WALLET_ADDR.FUNDER].final_balance
    withdraw = query[lib.CONFIG.WALLET_ADDR.WITHDRAW].final_balance

    //Amount other than withdraw, funder balance
    amount = total - funder - withdraw

    console.log(total, amount, funder, withdraw)

    if (amount < lib.CONFIG.MIN_BTC_CONSOLIDATE) {
        return {
            error: "-E- BTC amount too low to worth consolidating."
        };
    }

    //prep rpc command
    var batch = [{
        method: "sendtoaddress",
        parameters: [address, total, "", "", true]
    }];

    var res = await client.command(batch);
    if (validate(res).error) {
        return validate(res);
    }

    //console.log(res[0])
    return res[0];
}
*/

function delay(t, val) {
    return new Promise(function(resolve) {
        setTimeout(function() {
            resolve(val);
        }, t);
    });
}


async function fetchBtcPrice(convert = 'USD') {

    if (typeof convert != "string") {
        return {
            error: "Invalid input conversion value."
        }
    }

    var priceObj = await lib.requestpn(`${BLOCK_INFO}/ticker`)
    try {
        const data = JSON.parse(priceObj)
        if (data[convert].last == undefined) {
            return {
                error: "Conversion pair is not recognised, please try again later."
            }
        } else {
            return data[convert].last
        }
    } catch (err) {
        return {
            error: err
        }
    }
} //end of fetchBtcPrice

async function isSynced() {
    var result = await lib.requestpn(
            `${BLOCK_INFO}/latestblock`
        )
        .then(JSON.parse)
        .catch(e => {
            return {
                error: "Unable to query latest block from peer (blockchain.info), please try again later."
            }
        })

    //prep rpc command
    var batch = [{
        method: "getblockcount",
        parameters: []
    }]

    var rpcBlockHeight = await client.command(batch);
    if (validate(rpcBlockHeight).error) {
        return validate(rpcBlockHeight);
    }

    if (rpcBlockHeight < result.height) {
        return false
    } else {
        return true
    }
}

// Check if address exists in wallet.dat
async function isAddressInWallet(address) {
    
    //prep rpc command
    var batch = [{
        method: "getaccount",
        parameters: [address]
    }]

    var result = await client.command(batch);
    if (validate(result).error) {
        return validate(result);
    }

    if(result[0].length > 0){
        return true;
    }else{
        return false;
    }    
}

// Sync USDT transaction data to database
// async function syncTxToDb(startBlock, endBlock = null) {

//     if(endBlock === null){

//         var batch = [{
//             method: "getblockcount",
//             parameters: []
//         }]
    
//         var latestBlockHeight = await client.command(batch);
        
//         endBlock = latestBlockHeight[0];
//     }

//     for(blockHeight = startBlock; blockHeight <= endBlock; blockHeight++){
//         // console.log(blockHeight);
//         var batch = [{
//             method: "getblockhash",
//             parameters: [blockHeight]
//         }]
    
//         var blockHash = await client.command(batch);
//         blockHash = blockHash[0];

//         //prep rpc command
//         var batch = [{
//             method: "getblock",
//             parameters: [blockHash]
//         }];

//         var res = await client.command(batch);
//         if (validate(res).error) {
//             return validate(res);
//         }

//         res = res[0];
        
//         let currentEpoch = Math.floor(new Date() / 1000);

//         let txString = res.tx.join(",");

//         let exists = await lib.SQL.db.query(`SELECT 1 from blockchain_blocks where blk_id = ?`,
//             { replacements: [res.height], type: lib.SQL.db.QueryTypes.SELECT });

//         let rowObj = {};
//         for (const key in res) {
//             rowObj['blk_' + key] = res[key];
//         }

//         if(exists.length == 0){

//             rowObj['blk_id'] = res.height;
//             rowObj['blk_tx'] = txString;
//             rowObj['blk_createdEpoch'] = currentEpoch;

//             await lib.SQL.blockchain_blocks.create(rowObj);

//         }else{

//             rowObj['blk_id'] = res.height;
//             rowObj['blk_tx'] = txString;
//             rowObj['blk_lastUpdatedEpoch'] = currentEpoch;

//             await lib.SQL.blockchain_blocks.update(rowObj, {where: {blk_id: rowObj.blk_id}});

//         }

//         var batch = [{
//             method: "omni_listblocktransactions",
//             parameters: [blockHeight]
//         }]
    
//         let arrTxids = await client.command(batch);
//         arrTxids = arrTxids[0];

//         await utility.asyncForEach(arrTxids, async (currVal, currIndex, arr) => {
//             try{

//                 await delay(2);
//                 // console.log(blockHeight);
//                 // console.log(currVal);
        
//                 let txid = currVal;
        
//                 let batch = [{
//                     method: "omni_gettransaction",
//                     parameters: [txid]
//                 }]
        
//                 let result = await client.command(batch);
//                 result = result[0];
                
//                 let arrTxData = [];
//                 let wherePropId = true;

//                 switch(result.type) {
//                     case 'Send All':
                    
//                         for (let subTxData of result.subsends) {
                    
//                             let copyTxData = result;
                            
//                             copyTxData.subType = 'Subsend';
//                             copyTxData.propertyid = subTxData.propertyid;
//                             copyTxData.divisible = subTxData.divisible;
//                             copyTxData.amount = subTxData.amount;
//                             arrTxData.push(copyTxData);
//                         }
                    
//                         break;
//                     case 'DEx Purchase':

//                         for (let subTxData of result.purchases) {
                    
//                             let copyTxData = result;
                            
//                             copyTxData.subType = 'Purchases';
//                             copyTxData.vout = subTxData.vout;
//                             copyTxData.amountpaid = subTxData.amountpaid;
//                             copyTxData.ismine = subTxData.ismine;
//                             copyTxData.referenceaddress = subTxData.referenceaddress;
//                             copyTxData.propertyid = subTxData.propertyid;
//                             copyTxData.amount = subTxData.amountbought;
//                             copyTxData.valid = subTxData.valid;
//                             copyTxData.invalidreason = subTxData.invalidreason || null;
//                             arrTxData.push(copyTxData);
//                         }
                    
//                         break;
//                     case 'Create Property - Fixed':
//                     case 'Create Property - Variable':
//                     case 'MetaDEx trade':
//                     case 'Create Property - Manual':
//                     case 'Feature Activation':
//                     case 'ALERT':
//                     case 'MetaDEx cancel-price':
//                     case 'MetaDEx cancel-ecosystem':
//                         wherePropId = false;
//                         break;
//                     default:
//                         arrTxData.push(result);
//                 }
                
//                 let exists = await lib.SQL.db.query(`SELECT 1 from omni_transactions where otx_txid = ?`, 
//                     {replacements: [txid], type: lib.SQL.db.QueryTypes.SELECT});
        
//                 let currentEpoch = Math.floor(new Date() / 1000);
                
//                 for(let txData of arrTxData){

//                     let rowObj = {};
//                     for (const key in txData) {
//                         rowObj['otx_' + key] = txData[key];
//                     }
                    
//                     if(exists.length == 0){
                        
//                         rowObj['otx_createdEpoch'] = currentEpoch;

//                         await lib.SQL.omni_transactions.create(rowObj); 
            
//                     }else{
//                         rowObj['otx_lastUpdatedEpoch'] = currentEpoch;

//                         if(wherePropId){
//                             await lib.SQL.omni_transactions.update(rowObj, 
//                                 {where: {
//                                     otx_txid: rowObj.otx_txid, 
//                                     otx_propertyid: rowObj.otx_propertyid
//                                 }}
//                             );   
//                         }else{
//                             await lib.SQL.omni_transactions.update(rowObj, 
//                                 {where: {
//                                     otx_txid: rowObj.otx_txid
//                                 }}
//                             );  
//                         }
                                             
//                     }
                    
//                 }
//             }catch(e){
//                 console.log(e);
//             }
//         });
//     }
    
//     return true;
// }


module.exports = {
    genWallet: async function() {
        return await createAcc();
    }, //end of genWallet

    getTxHistory: async function(address) {
        return await listTransactions(address);
    }, //end of getTxHistory

    getBalance: async function(addresses) {
        return await getBalance(addresses);
    }, //end of getBalance

    sendUsdtTx: async function(amount, recipient, sender, funder = null) {
        return await sendUsdtTx(amount, recipient, sender, funder);
    },

    getTxDetail: async function(txid) {
        return await fetchTransaction(txid);
    },

    getBtcPrice: async function(convert = "USD") {
        return await fetchBtcPrice(convert)
    },

    validateRpc: async function(result) {
        return await validate(result)
    },

    computeUSDTReceivedSQL: async function(address = null) {
        return await computeUSDTReceivedSQL(address)
    },

    computeUSDTReceived: async function(address = null) {
        return await computeUSDTReceived(address)
    },

    isSynced: async function() {
        return await isSynced()
    },

    consolidateBtcTo: async function(address = lib.CONFIG.WALLET_ADDR.FUNDER) {
        return await consolidateBtcTo(address)
    },

    fetchUsdtBal: async function(address = null) {
        return await fetchUsdtBal(address)
    },

    //Expects addresses as array.
    fetchBtcBal: async function(addresses = null) {
        return await fetchBtcBal(addresses)
    },

    fetchBtcBalWallet: async function() {
        return await fetchBtcBal_wallet()
    },

    estimateFeeUsd: async function(size = 405, blocks = 6) {
        return await estimateFeeUsd(size, blocks)
    }

}