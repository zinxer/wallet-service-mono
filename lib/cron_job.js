// TODO: Detect unconfirmed incoming transactions
const wallet = require("./wallet-local.js")

// const usdt_pg = require("./usdt_pg-local.js"); // Requiring usdt_pg will cause cyclical dependancy
const lib = require("./lib.js")
const log = require("./console_log.js")
const CronJob = require("cron").CronJob
const dashboard = require("./dashboard.js");
const OMNIEXP_LINK = 'https://omniexplorer.info/address/'
const ETHUSDT_EXP_LINK = "https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7?a=";
const ErrorHandler = require("../ErrorHandler");
const SQL = lib.SQL;
const USDT = 31;

function isSufficient(result) {
    if (result == undefined) {
        return {
            error: "Please specify rpc result in argument."
        }
    }
    if (JSON.stringify(result).toLowerCase().includes("insufficient balance") || JSON.stringify(result).toLowerCase().includes("fees may not be sufficient")) {
        return false
    } else {
        return true
    }
} //end of isSufficient

function delay(t, val) {
    return new Promise(function(resolve) {
        setTimeout(function() {
            resolve(val);
        }, t);
    });
} //end of delay

async function resetScheduleClearFlag() {
    let currentEpoch = Math.floor(new Date() / 1000)
    if ((currentEpoch - start_schedule_usdt_clear_epoch) > (5 * 60)) {
        //It's been more than 5 mins since schedule_usdt_clear_job was run. Reset status now
        log.warning("Last start_schedule_usdt_clear_epoch more than 5 mins, resetting status.")
        schedule_usdt_clear_flag = true
    }
    return
}

async function update_estimated_network_fees() {

    try {

        let netFeeObj = await SQL.configs.findAll({
            where: {
                conf_cat1: 'NETWORK_FEE'
            }
        });

        for (let netFeeRow of netFeeObj) {

            let nodeToken = netFeeRow.conf_cat2 + '_' + netFeeRow.conf_cat3;
            let size = 405;
            let blocks = 6;

            // Set default sender, recipient, amount for Eth Transaction estimation (Does not perform transaction)
            let params = {
                coinType: nodeToken,
                size: size,
                blocks: blocks,
                sender: lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW,
                recipient: lib.CONFIG.ETH_WALLET_ADDR.COLD,
                amount: '0'
            }

            let estimatedNetFee = await lib.walletObj.estimateFee(params);

            await netFeeRow.update({
                conf_value: Number(estimatedNetFee).toFixed(4)
            });
        }

    } catch (err) {
        console.log(err);
        throw err;
    }
} //end of update_estimated_network_fees

async function update_sendFeeUsd() {
    //console.log("-I- Updating send fee in USD...")

    let feePrice = null;

    try {
        let fundTxs = await SQL.eth_fund_txs.findAll({
            where: {
                eft_sendFee: {
                    [lib.Op.ne]: null
                },
                eft_sendFeeUsd: null
            }
        });

        for (let fundData of fundTxs) {
            let nodeToken = 'ETH' + '_' + fundData.eft_token;

            let params = {
                coinType: nodeToken
            }

            feePrice = await lib.walletObj.getFeePrice(params);

            fundData.update({
                eft_sendFeeUsd: parseFloat(Number(fundData.eft_sendFee) * Number(feePrice)).toFixed(4)
            });
        }


        SQL.usdt_clear_batches.findAll({
                where: {
                    sendFee: {
                        [lib.Op.ne]: null
                    },
                    sendFeeUsd: null
                }
            })
            .then(async jobs => {

                if (jobs.length < 1) {
                    return Promise.resolve()
                }

                let tempArr = [];

                for (let job of jobs) {

                    let nodeToken = job.node + '_' + job.token;

                    let params = {
                        coinType: nodeToken
                    }

                    feePrice = await lib.walletObj.getFeePrice(params);

                    //check for error
                    if (feePrice.error) {
                        return Promise.reject(feePrice.error);
                    }

                    tempArr.push(
                        job.update({
                            sendFeeUsd: parseFloat(Number(job.sendFee) * Number(feePrice)).toFixed(4)
                        })
                    );

                }

                return Promise.all(tempArr);
            });


        SQL.usdt_clear_deposits.findAll({
                where: {
                    ucd_sendFee: {
                        [lib.Op.ne]: null
                    },
                    ucd_sendFeeUsd: null
                }
            })
            .then(async jobs => {

                if (jobs.length < 1) {
                    return Promise.resolve()
                }

                let tempArr = [];

                for (let job of jobs) {

                    let nodeToken = job.ucd_node + '_' + job.ucd_token;

                    let params = {
                        coinType: nodeToken
                    }

                    feePrice = await lib.walletObj.getFeePrice(params);

                    //check for error
                    if (feePrice.error) {
                        return Promise.reject(feePrice.error);
                    }

                    tempArr.push(
                        job.update({
                            ucd_sendFeeUsd: parseFloat(Number(job.ucd_sendFee) * Number(feePrice)).toFixed(4)
                        })
                    );

                }

                return Promise.all(tempArr);
            });


        SQL.withdrawals.findAll({
            where: {
                sendFee: {
                    [lib.Op.ne]: null
                },
                sendFeeUsd: null
            }
        }).then(async jobs => {

            if (jobs.length < 1) {
                return Promise.resolve()
            }

            let tempArr = [];

            for (let job of jobs) {

                let nodeToken = job.node + '_' + job.token;

                let params = {
                    coinType: nodeToken
                }
                feePrice = await lib.walletObj.getFeePrice(params);

                //check for error
                if (feePrice.error) {
                    return Promise.reject(feePrice.error);
                }

                tempArr.push(
                    job.update({
                        sendFeeUsd: parseFloat(Number(job.sendFee) * Number(feePrice)).toFixed(4)
                    })
                );

            }

            return Promise.all(tempArr);
        });

    } catch (err) {
        log.error("E1:" + err)
        let params = {
            type: "Cron",
            cat1: "E1",
            msg: "Failed in update_sendFeeUsd()",
            error: err
        }
        ErrorHandler.LogError(params);
        throw err;
    }
} //end of update_sendFeeUsd

async function invalidateCode() {
    try {
        //console.log("-I- Expiring 2FA and vericode.");
        var now = Math.floor(new Date() / 1000);

        //find all 2FA first.
        await SQL.users
            .findAll({
                where: {
                    code2fa: {
                        [lib.Op.ne]: null
                    }
                }
            })
            .then(async user2FA => {
                if (user2FA) {
                    await user2FA.forEach(async(user, index) => {
                        if (
                            user.code2faEpoch == null ||
                            now - user.code2faEpoch > lib.CONFIG.EXPIRE_CODE_SEC
                        ) {
                            //clear 2FA
                            user.update({
                                code2fa: null,
                                code2faEpoch: null
                            });
                        }
                    }); //end of forEach
                }
            })
            .catch(err => {
                log.error('E91:' + err);
                let params = {
                    type: "Cron",
                    cat1: "E91",
                    msg: "Failed in invalidateCode()",
                    error: err
                }
                ErrorHandler.LogError(params);
                return {
                    error: "Something went wrong, please try again later."
                };
            }); //end of catch

        //find all 2FA first.
        await SQL.users
            .findAll({
                where: {
                    vericode: {
                        [lib.Op.ne]: null
                    }
                }
            })
            .then(async userVericode => {
                if (userVericode) {
                    await userVericode.forEach(async(user, index) => {
                        if (
                            user.vericodeEpoch == null ||
                            now - user.vericodeEpoch > lib.CONFIG.EXPIRE_CODE_SEC
                        ) {
                            //clear 2FA
                            user.update({
                                vericode: null,
                                vericodeEpoch: null
                            });
                        }
                    }); //end of forEach
                }
            })
            .catch(err => {
                log.error('E92:' + err);
                let params = {
                    type: "Cron",
                    cat1: "E92",
                    msg: "Failed in invalidateCode()",
                    error: err
                }
                ErrorHandler.LogError(params);
                return {
                    error: "Something went wrong, please try again later."
                };
            }); //end of catch
    } catch (err) {
        let params = {
            type: "Cron",
            cat1: "DB",
            msg: "Failed in invalidateCode()",
            error: err
        }
        ErrorHandler.LogError(params);
    }
} //end of invalidateCode

async function checkNodeSynced() {
    var res = await wallet.isSynced()

    if (res.error) {
        //await lib.bot.sendMonGrpMessage("-E- Node error when query latest block: " + res.error)
    } else if (!res) {
        await lib.bot.sendMonGrpMessage("-E- Node not synced to latest block")
    } else {
        //all good, do nothing!
    }
}

async function schedule_usdt_clear_job() {
    schedule_usdt_clear_flag = false;
    await delay(5000); //so that it doesn't flood DB with queries.
    // Measure time taken to complete schedule function
    //console.time("schedule_usdt_clear_job loop");

    return new Promise(async(resolve, reject) => {

        try {
            //only get addresses under 48 hours
            let currentEpoch = Math.floor(new Date() / 1000);
            start_schedule_usdt_clear_epoch = currentEpoch
            let epochRange = currentEpoch - (48 * 60 * 60) //172800 = 48 hours

            let paymentAddrs = await SQL.db.query(`
                select 
                    merchantId as 'merchantId', paymentAddr as 'paymentAddr', orderId as 'orderId', amount as 'amount', 'PAYMENT' as 'paymentType', node as 'node', token as 'token'
                from usdt_tx_batches where status is not null and isProcessing = false and createdEpoch >= ?
                union
                select
                    mda_merchantId, mda_depositAddr, null, null, 'DEPOSIT', mda_node, mda_token
                from merch_deposit_addrs where mda_isProcessing = false
            `, {
                replacements: [epochRange],
                type: SQL.db.QueryTypes.SELECT
            });

            if (paymentAddrs.length < 1) {
                log.debug("Payment Addresses < 1")
                return resolve();
            }

            let addrs = paymentAddrs.map(tx => tx.paymentAddr)

            let params = {
                addresses: addrs
            }

            let balances = await lib.walletObj.getAllBalances(params)
                //console.log(balances)
            log.debug("Addrs Count: " + Object.keys(balances).length)

            if (Object.keys(balances).length < 1) {
                return resolve();
            }

            let minForwardAmtEth = await SQL.configs.findOne({
                where: {
                    conf_code: "MIN_ETH_FORWARD_AMT",
                    conf_cat1: "MIN_FORWARD",
                    conf_cat2: "ETH"
                }
            });

            let minForwardAmtUSDT = await SQL.configs.findOne({
                where: {
                    conf_code: "MIN_USDT_FORWARD_AMT",
                    conf_cat1: "MIN_FORWARD",
                    conf_cat2: "USDT"
                }
            });

            for (let payAddrData of paymentAddrs) {

                //TODO: this forEach loop does not wait for SQL to complete query, hence parseFloat(balances[paymentData.address].usdt) is required instead of assigning it to a variable. 
                //balance has not been scheduled to clear yet
                //only clear balances that is more than 3USDT; Not worth clearing if too little.
                //check if a pending clear job had been scheduled.

                // If no balance found for transaction address or address not found in wallet then skip
                if (balances[payAddrData.paymentAddr] == undefined) {
                    continue;
                }

                if (payAddrData.token == "ETH") { //May not need ETH here
                    minForwardAmt = minForwardAmtEth.conf_value
                } else if (payAddrData.token == "USDT") {
                    minForwardAmt = minForwardAmtUSDT.conf_value
                }

                let nodeToken = payAddrData.node + '_' + payAddrData.token;

                if (parseFloat(balances[payAddrData.paymentAddr][nodeToken]) < minForwardAmt) {
                    //log.debug(payAddrData.paymentAddr + " " + parseFloat(balances[payAddrData.paymentAddr][nodeToken]))
                    continue;
                }

                //get userData
                let userData = await SQL.users.findOne({
                    where: {
                        merchantId: payAddrData.merchantId
                    }
                });

                if (payAddrData.paymentType == 'PAYMENT') {

                    // Do not process if a record is found using the SQL Query Below
                    let processingTx = await SQL.usdt_clear_batches.findOne({
                        where: {
                            orderId: payAddrData.orderId,
                            merchantId: payAddrData.merchantId,
                            paymentAddr: payAddrData.paymentAddr,
                            status: ['OPEN', 'FUNDING', 'FUNDED', 'PENDING'],
                            node: payAddrData.node,
                            token: payAddrData.token
                        }
                    });

                    if (processingTx) {
                        continue;
                    }

                    // Returns NaN if no record found
                    let latestSuccessTx = await SQL.usdt_clear_batches.max("confirmedEpoch", {
                        where: {
                            paymentAddr: payAddrData.paymentAddr,
                            node: payAddrData.node,
                            token: payAddrData.token
                        }
                    });

                    var now = Math.floor(new Date() / 1000);

                    //Because get USDT balance has a delay to return result.
                    //We want to make sure the last clear tx was not confirmed while get USDT balance was executed first.
                    if ((Number.isNaN(latestSuccessTx)) || ((now - latestSuccessTx) > 60)) {
                        //skip if latest SUCCESS tx is less than 60 seconds ago.
                        //We assume it takes max 60 seconds to get USDT balances.

                        await SQL.usdt_clear_batches.create({
                            merchantId: payAddrData.merchantId,
                            orderId: payAddrData.orderId,
                            createdEpoch: Math.floor(new Date() / 1000),
                            amount: parseFloat(balances[payAddrData.paymentAddr][nodeToken]),
                            fee: userData.fee,
                            paymentAddr: payAddrData.paymentAddr,
                            status: "OPEN",
                            node: payAddrData.node,
                            token: payAddrData.token
                        });

                        await SQL.usdt_tx_batches.update({
                            isProcessing: true
                        }, /* Columns to update */ {
                            where: {
                                merchantId: payAddrData.merchantId,
                                node: payAddrData.node,
                                token: payAddrData.token,
                                paymentAddr: payAddrData.paymentAddr
                            }
                        } /* where clause */ );
                    }

                } //end of if (payAddrData.paymentType == 'PAYMENT') {

                let depositId = null;

                if (payAddrData.paymentType == 'DEPOSIT') {

                    // Do not process if a record is found using the SQL Query Below
                    let processingTx = await SQL.usdt_clear_deposits.findOne({
                        where: {
                            ucd_merchantId: payAddrData.merchantId,
                            ucd_depositAddr: payAddrData.paymentAddr,
                            ucd_status: ['OPEN', 'FUNDING', 'FUNDED', 'PENDING'],
                            ucd_node: payAddrData.node,
                            ucd_token: payAddrData.token
                        }
                    });

                    if (processingTx) {
                        continue;
                    }

                    // Returns NaN if no record found
                    let latestSuccessTx = await SQL.usdt_clear_deposits.max("ucd_confirmedEpoch", {
                        where: {
                            ucd_depositAddr: payAddrData.paymentAddr,
                            ucd_node: payAddrData.node,
                            ucd_token: payAddrData.token
                        }
                    });

                    var now = Math.floor(new Date() / 1000)

                    //Because get USDT balance has a delay to return result.
                    //We want to make sure the last clear tx was not confirmed while get USDT balance was executed first.
                    if ((Number.isNaN(latestSuccessTx)) || ((now - latestSuccessTx) > 60)) {
                        //skip if latest SUCCESS tx is less than 60 seconds ago.
                        //We assume it takes max 60 seconds to get USDT balances.

                        depositId = lib.randomize('Aa0', 12);

                        SQL.usdt_clear_deposits.create({
                            ucd_merchantId: payAddrData.merchantId,
                            ucd_depositId: depositId,
                            ucd_createdEpoch: Math.floor(new Date() / 1000),
                            ucd_amount: parseFloat(balances[payAddrData.paymentAddr][nodeToken]),
                            ucd_depositFee: userData.fee,
                            ucd_resellerFee: userData.reseller_fee,
                            ucd_depositAddr: payAddrData.paymentAddr,
                            ucd_status: "OPEN",
                            ucd_node: payAddrData.node,
                            ucd_token: payAddrData.token
                        });

                        await SQL.merch_deposit_addrs.update({
                            mda_isProcessing: true
                        }, /* Columns to update */ {
                            where: {
                                mda_merchantId: payAddrData.merchantId,
                                mda_node: payAddrData.node,
                                mda_token: payAddrData.token,
                                mda_depositAddr: payAddrData.paymentAddr
                            }
                        } /* where clause */ );

                    }
                } //end of if (payAddrData.paymentType == 'DEPOSIT') {

                let message = (payAddrData.orderId != null) ? " orderId: " + payAddrData.orderId : " depositId: " + depositId;
                log.debug(
                    "-I- Forwarding merchantId: " +
                    payAddrData.merchantId +
                    message +
                    " amount: " +
                    parseFloat(balances[payAddrData.paymentAddr][nodeToken]) +
                    " paymentAddr: " +
                    payAddrData.paymentAddr
                );

                // Check if user is logged in and a web socket is connected
                if (lib.webSocket.isClientConnected(payAddrData.merchantId)) {

                    let balResults = await dashboard.fetchWithdrawBal(payAddrData.merchantId);

                    let emitJson = {
                        merchantId: payAddrData.merchantId,
                        data: balResults
                    }

                    lib.webSocket.emitBalances(emitJson);
                }
            } //end of for (let payAddrData of paymentAddrs)

            //console.timeEnd("schedule_usdt_clear_job loop")
        } catch (err) {
            return reject(err);
        }

        return resolve();

    });
} //end of schedule_usdt_clear_job

// Push all scheduled OPEN OMNI forward orders transactions.
async function push_usdt_clear_job() {

    push_usdt_clear_flag = false;
    //await log.debug("Entered push_usdt_clear_job")
    await delay(5000); //so that it doesn't flood DB with queries.
    return new Promise(async(resolve, reject) => {

        try {

            let openTxs = await SQL.usdt_clear_batches.findAll({
                where: {
                    status: "OPEN",
                    node: 'OMNI'
                }
            })

            if (openTxs.length < 1) {
                return resolve();
            }

            var funderAddr = lib.CONFIG.WALLET_ADDR.FUNDER
            var usdtColdWallet = lib.CONFIG.WALLET_ADDR.DESTADDR

            for (let transaction of openTxs) {

                let forcePush = false;
                var next = false //reset

                // Check if user has switched on force push
                let user = await SQL.users.findOne({
                    where: {
                        merchantId: transaction.merchantId,
                        isActive: true
                    }
                });

                if (user.length < 1) {
                    var message = "-E- Merchant ID not found. Unable to push transaction"
                    log.error(message);
                    next = true;
                    continue;
                }

                forcePush = user.forceTx;

                let nodeToken = transaction.node + '_' + transaction.token;

                let params = {
                    coinType: nodeToken
                }

                let feeUSD = await lib.walletObj.estimateFee(params);

                if (!forcePush && feeUSD > lib.CONFIG.MAX_SEND_FEE) {
                    log.info("Forward push tx paused, fee exceeds: " + lib.CONFIG.MAX_SEND_FEE + ". current: " + feeUSD);
                    continue;
                }

                while (!next) {
                    //Just incase
                    if (transaction.amount == 0) {
                        next = true
                        break
                    }

                    let toColdParams = {
                        coinType: nodeToken,
                        sender: transaction.paymentAddr,
                        recipient: usdtColdWallet,
                        amount: transaction.amount,
                        funder: funderAddr
                    }

                    res = await lib.walletObj.sendTransaction(toColdParams);

                    //check if auto_send is false
                    if (res.skip) {
                        console.log("-I- Skipping usdt omni_send withdrawal: ", transaction.orderId)
                        next = true;
                        break;
                    }

                    if (!isSufficient(res)) {
                        var message = "-W- Insufficient funder balance \nPayment: *" + transaction.paymentAddr + "* \nId: *" + transaction.orderId + "*"
                            //await lib.bot.sendGrpMessage(message)
                            //console.log(message)
                        next = true;
                        break;
                    }

                    if (!res.error) {
                        await transaction.update({
                            destinationAddr: usdtColdWallet,
                            funderAddr: funderAddr,
                            status: "PENDING",
                            txid: res
                        })

                        let params = {
                            coinType: nodeToken,
                            address: transaction.paymentAddr
                        }

                        let totalReceived = await lib.walletObj.computeAddressReceivedSQL(params);

                        let currentReceived = parseFloat(transaction.amount);

                        await SQL.ipn_history.create({
                            ipn_merchantId: transaction.merchantId,
                            ipn_orderId: transaction.orderId,
                            ipn_paymentAddr: transaction.paymentAddr,
                            ipn_transactionAmt: transaction.amount,
                            ipn_currentReceived: currentReceived,
                            ipn_totalReceived: totalReceived,
                            ipn_status: "PENDING",
                            ipn_epoch: Math.floor(new Date() / 1000)
                        });

                        for (i = 1; i <= 5; i++) {
                            let result = await dashboard.ipn_post(transaction, currentReceived, totalReceived);
                            if (result === true) {
                                break;
                            }
                            await delay(5000);
                        }

                        //Update order status in usdt_tx_batches table if total received >= order amount
                        let order = await SQL.usdt_tx_batches.findOne({
                            where: {
                                merchantId: transaction.merchantId,
                                orderId: transaction.orderId,
                                paymentAddr: transaction.paymentAddr
                            }
                        })

                        if ((totalReceived >= order.amount) && (order.status !== "CONFIRMED")) {
                            //update order status
                            await order.update({
                                status: "CONFIRMED",
                                confirmedEpoch: Math.floor(new Date() / 1000)
                            })
                        }

                        next = true;
                        break;
                    } // if statement for sendTransaction res
                } //end of while loop

            } //end of for loop

        } catch (err) {
            throw err;
        }

        return resolve();

    });
} //end of push_usdt_clear_job

// Sends ETH to fund token transfers from Orders payment addresses to cold wallet
async function fund_eth_orders_job() {
    fund_eth_orders_flag = false;
    //await log.debug("Entered fund_eth_orders_job")
    await delay(5000); //so that it doesn't flood DB with queries.
    return new Promise(async(resolve, reject) => {

        try {
            let ethHotWallet = lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW;
            let ethColdWallet = lib.CONFIG.ETH_WALLET_ADDR.COLD;

            let openEthTxs = await SQL.usdt_clear_batches.findAll({
                where: {
                    status: "OPEN",
                    node: 'ETH',
                    paymentAddr: {
                        [lib.Op.ne]: ethHotWallet
                    }
                }
            });

            if (openEthTxs.length < 1) {
                return resolve();
            }

            for (let transaction of openEthTxs) {
                let next = false //reset

                let nodeToken = transaction.node + '_' + transaction.token;

                // If it is an ETH transaction no need to add extra funds
                if (nodeToken == 'ETH_ETH') {
                    await transaction.update({
                        status: "FUNDED"
                    });

                    continue;
                }

                //Just incase
                if (transaction.amount == 0) {
                    next = true
                    continue
                }

                // Estimate ether cost to sweep from payment addr to cold wallet
                let estEthToColdWallet = await lib.walletObj.estimateEtherCost({
                    coinType: nodeToken,
                    sender: transaction.paymentAddr,
                    recipient: ethColdWallet,
                    amount: transaction.amount
                });

                // Get Ethereum Balance
                let getEthBalParams = {
                    coinType: 'ETH_ETH',
                    address: transaction.paymentAddr,
                }

                let ethBal = await lib.walletObj.getBalance(getEthBalParams);

                // Send slightly extra just in case
                let ethToSend = parseFloat(estEthToColdWallet - ethBal) * 1.8;

                if (ethToSend <= 0) {
                    await transaction.update({
                        status: "FUNDED"
                    });
                    next = true
                    continue
                }

                let params = {
                    coinType: 'ETH_ETH',
                    sender: ethHotWallet,
                    recipient: transaction.paymentAddr,
                    amount: ethToSend.toFixed(8)
                }

                log.debug(
                    "-I- Funding paymentAddr: " +
                    transaction.paymentAddr +
                    " value: " +
                    ethToSend.toFixed(8)
                );

                res = await lib.walletObj.sendTransaction(params);

                //check if auto_send is false
                if (res.skip) {
                    console.log("-I- Skipping " + transaction.node + " " + transaction.token + " funding: ", transaction.orderId)
                    next = true
                    continue
                }

                if (!isSufficient(res)) {
                    var message = "-W- Insufficient gas balance \nPayment: *" + transaction.paymentAddr + "* \nId: *" + transaction.orderId + "*";
                    next = true
                    continue
                }

                let currEpoch = Math.floor(new Date() / 1000);

                await SQL.eth_fund_txs.create({
                    eft_merchantId: transaction.merchantId,
                    eft_type: 'ORDER',
                    eft_orderId: transaction.orderId,
                    eft_createdEpoch: currEpoch,
                    eft_token: transaction.token,
                    eft_amount: ethToSend.toFixed(8),
                    eft_paymentAddr: transaction.paymentAddr,
                    eft_status: 'PENDING',
                    eft_txid: res
                });

                await transaction.update({
                    status: "FUNDING"
                });

            } //end of openEthTxs.forEach


        } catch (err) {
            log.error("-E[5]- " + err);
            throw err;
        }

        return resolve();

    });
} //end of fund_eth_orders_job

// Sends ETH to fund token transfers from Deposits addresses to cold wallet
async function fund_eth_deposits_job() {

    fund_eth_deposits_flag = false;
    //await log.debug("Entered fund_eth_deposits_job")
    await delay(60000); //so that it doesn't flood DB with queries.
    return new Promise(async(resolve, reject) => {

        try {

            let ethHotWallet = lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW;
            let ethColdWallet = lib.CONFIG.ETH_WALLET_ADDR.COLD;

            let openEthTxs = await SQL.usdt_clear_deposits.findAll({
                where: {
                    ucd_status: "OPEN",
                    ucd_node: 'ETH',
                    ucd_depositAddr: {
                        [lib.Op.ne]: ethHotWallet
                    }
                }
            });

            if (openEthTxs.length < 1) {
                return resolve();
            }

            for (let transaction of openEthTxs) {
                let next = false //reset

                let nodeToken = transaction.ucd_node + '_' + transaction.ucd_token;

                // If it is an ETH transaction no need to add extra funds
                if (nodeToken == 'ETH_ETH') {
                    await transaction.update({
                        ucd_status: "FUNDED"
                    });

                    continue;
                }

                //Just incase
                if (transaction.ucd_amount == 0) {
                    next = true
                    continue
                }

                // Estimate ether cost to sweep from payment addr to cold wallet
                let estEthToColdWallet = await lib.walletObj.estimateEtherCost({
                    coinType: nodeToken,
                    sender: transaction.ucd_depositAddr,
                    recipient: ethColdWallet,
                    amount: transaction.ucd_amount
                });

                // Get Ethereum Balance
                let getEthBalParams = {
                    coinType: 'ETH_ETH',
                    address: transaction.ucd_depositAddr,
                }

                let ethBal = await lib.walletObj.getBalance(getEthBalParams);

                // Send slightly extra just in case
                let ethToSend = parseFloat(estEthToColdWallet - ethBal) * 1.1;

                if (ethToSend <= 0) {
                    await transaction.update({
                        ucd_status: "FUNDED"
                    });
                    next = true
                    continue
                }

                let params = {
                    coinType: 'ETH_ETH',
                    sender: ethHotWallet,
                    recipient: transaction.ucd_depositAddr,
                    amount: ethToSend.toFixed(8)
                }

                res = await lib.walletObj.sendTransaction(params);

                //check if auto_send is false
                if (res.skip) {
                    console.log("-I- Skipping " + transaction.ucd_node + " " + transaction.ucd_token + " funding: ", transaction.ucd_depositId)
                    next = true
                    continue
                }

                if (!isSufficient(res)) {
                    var message = "-W- Insufficient gas balance \nPayment: *" + transaction.ucd_depositAddr + "* \nId: *" + transaction.ucd_depositId + "*";
                    next = true
                    continue
                }

                let currEpoch = Math.floor(new Date() / 1000);

                await SQL.eth_fund_txs.create({
                    eft_merchantId: transaction.ucd_merchantId,
                    eft_type: 'DEPOSIT',
                    eft_orderId: transaction.ucd_depositId,
                    eft_createdEpoch: currEpoch,
                    eft_token: transaction.ucd_token,
                    eft_amount: ethToSend.toFixed(8),
                    eft_paymentAddr: transaction.ucd_depositAddr,
                    eft_status: 'PENDING',
                    eft_txid: res
                });

                await transaction.update({
                    ucd_status: "FUNDING"
                });

            } //end of openEthTxs.forEach


        } catch (err) {
            log.error("-E[5]- " + err);
            throw err;
        }

        return resolve();

    });
} //end of fund_eth_deposits_job

//Check addresses if received ETH funds
async function update_eth_funded_job() {

    update_eth_funded_flag = false;
    //await log.debug("Entered update_eth_funded_job")
    await delay(5000); //so that it doesn't flood DB with queries.
    return new Promise(async(resolve, reject) => {

        try {

            let ethHotWallet = lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW;
            let tokenColdWallet = lib.CONFIG.ETH_WALLET_ADDR.COLD;

            let fundingEthTxs = await SQL.eth_fund_txs.findAll({
                where: {
                    eft_status: "PENDING",
                    eft_paymentAddr: {
                        [lib.Op.ne]: ethHotWallet
                    }
                }
            });

            if (fundingEthTxs.length < 1) {
                return resolve();
            }

            for (let fundData of fundingEthTxs) {

                let nodeToken = 'ETH_' + fundData.eft_token;

                // Get Ethereum Balance
                let getEthBalParams = {
                    coinType: 'ETH_ETH',
                    address: fundData.eft_paymentAddr
                }

                let ethBal = await lib.walletObj.getBalance(getEthBalParams);

                if (ethBal == 0) {
                    continue;
                }

                let txParams = {
                    coinType: 'ETH_ETH',
                    txid: fundData.eft_txid
                }

                let fundTxData = await lib.walletObj.getTransaction(txParams);

                if (!fundTxData.valid) {
                    continue;
                }

                let currEpoch = Math.floor(new Date() / 1000);

                await fundData.update({
                    eft_confirmedEpoch: currEpoch,
                    eft_status: 'SUCCESS',
                    eft_sendFee: fundTxData.fee,
                    eft_ethGasUsed: fundTxData.gasUsed,
                    eft_ethGasPrice: fundTxData.gasPrice,
                    eft_ethNonce: fundTxData.nonce
                });

                if (fundData.eft_type == 'ORDER') {

                    await SQL.usdt_clear_batches.update({
                        status: "FUNDED",
                    }, {
                        where: {
                            merchantId: fundData.eft_merchantId,
                            orderId: fundData.eft_orderId,
                            status: 'FUNDING',
                        }
                    });

                } else if (fundData.eft_type == 'DEPOSIT') {

                    await SQL.usdt_clear_deposits.update({
                        ucd_status: "FUNDED",
                    }, {
                        where: {
                            ucd_merchantId: fundData.eft_merchantId,
                            ucd_depositId: fundData.eft_orderId,
                            ucd_status: 'FUNDING',
                        }
                    });

                }

            } //end of fundingEthTxs.forEach

        } catch (err) {
            log.error("-E[6]- " + err)
            throw err;
        }

        return resolve();

    });
} //end of update_eth_funded_job

// Push all scheduled funded ERC20 Orders forward transactions.
async function push_eth_orders_job() {

    push_eth_orders_flag = false;
    await delay(5000); //so that it doesn't flood DB with queries.
    return new Promise(async(resolve, reject) => {

        try {

            let ethHotWallet = lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW;
            let tokenColdWallet = lib.CONFIG.ETH_WALLET_ADDR.COLD;

            let fundedEthTxs = await SQL.usdt_clear_batches.findAll({
                where: {
                    status: "FUNDED",
                    node: 'ETH',
                    paymentAddr: {
                        [lib.Op.ne]: ethHotWallet
                    }
                }
            });

            if (fundedEthTxs.length < 1) {
                return resolve();
            }

            for (let transaction of fundedEthTxs) {

                let next = false //reset

                let nodeToken = transaction.node + '_' + transaction.token;

                //Just incase
                if (transaction.amount == 0) {
                    next = true
                    continue
                }

                let getEthBalParams = {
                    coinType: 'ETH_ETH',
                    address: transaction.paymentAddr
                }

                let ethBal = await lib.walletObj.getBalance(getEthBalParams);

                let estCostParams = {
                    coinType: nodeToken,
                    sender: transaction.paymentAddr,
                    recipient: tokenColdWallet,
                    amount: transaction.amount
                }

                let estEthCost = await lib.walletObj.estimateEtherCost(estCostParams);

                // If ethereum in wallet not enough to fund transfer to cold wallet
                if (parseFloat(ethBal) < parseFloat(estEthCost)) {
                    // let message = "-W- Insufficient ethereum balance to sweep to cold wallet \nAmount: *" + ethBal + " ETH* \nEstimated Amount Required: *" + estEthCost + " ETH*\nOrder ID: *" + transaction.orderId + "*"
                    // await lib.bot.sendGrpMessage(message);
                    await transaction.update({
                        status: "OPEN"
                    })
                    next = true
                    continue
                }

                let sendParams = {
                    coinType: nodeToken,
                    sender: transaction.paymentAddr,
                    recipient: tokenColdWallet,
                    amount: transaction.amount
                }

                res = await lib.walletObj.sendTransaction(sendParams);

                if (res.skip) {
                    console.log("-I- Skipping " + transaction.node + " " + transaction.token + " sweep to cold wallet: ", transaction.orderId)
                    next = true
                    continue
                }

                await transaction.update({
                    destinationAddr: tokenColdWallet,
                    status: "PENDING",
                    txid: res
                });

                let params = {
                    coinType: nodeToken,
                    address: transaction.paymentAddr
                }

                let totalReceived = await lib.walletObj.computeAddressReceivedSQL(params);

                let currentReceived = parseFloat(transaction.amount);

                await SQL.ipn_history.create({
                    ipn_merchantId: transaction.merchantId,
                    ipn_orderId: transaction.orderId,
                    ipn_paymentAddr: transaction.paymentAddr,
                    ipn_transactionAmt: transaction.amount,
                    ipn_currentReceived: currentReceived,
                    ipn_totalReceived: totalReceived,
                    ipn_status: "PENDING",
                    ipn_epoch: Math.floor(new Date() / 1000)
                });

                for (i = 1; i <= 5; i++) {
                    let result = await dashboard.ipn_post(transaction, currentReceived, totalReceived);
                    if (result === true) {
                        break;
                    }
                    await delay(5000);
                }

                //Update order status in usdt_tx_batches table if total received >= order amount
                let order = await SQL.usdt_tx_batches.findOne({
                    where: {
                        merchantId: transaction.merchantId,
                        orderId: transaction.orderId,
                        paymentAddr: transaction.paymentAddr
                    }
                })

                if ((totalReceived >= order.amount) && (order.status !== "CONFIRMED")) {
                    //update order status
                    await order.update({
                        status: "CONFIRMED",
                        confirmedEpoch: Math.floor(new Date() / 1000)
                    })
                }

            } //end of fundedEthTxs.forEach


        } catch (err) {
            log.error("-E[7]- " + err)
            throw err;
        }

        return resolve();

    });
} //end of push_eth_orders_job

// Push all scheduled funded ERC20 Deposits forward transactions.
async function push_eth_deposits_job() {

    push_eth_deposits_flag = false;
    await delay(60000); //so that it doesn't flood DB with queries.
    return new Promise(async(resolve, reject) => {

        try {

            let ethHotWallet = lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW;
            let tokenColdWallet = lib.CONFIG.ETH_WALLET_ADDR.COLD;

            let fundedEthTxs = await SQL.usdt_clear_deposits.findAll({
                where: {
                    ucd_status: "FUNDED",
                    ucd_node: 'ETH',
                    ucd_depositAddr: {
                        [lib.Op.ne]: ethHotWallet
                    }
                }
            });

            if (fundedEthTxs.length < 1) {
                return resolve();
            }

            for (let transaction of fundedEthTxs) {

                let next = false //reset

                let nodeToken = transaction.ucd_node + '_' + transaction.ucd_token;

                //Just incase
                if (transaction.ucd_amount == 0) {
                    next = true
                    continue
                }

                let getEthBalParams = {
                    coinType: 'ETH_ETH',
                    address: transaction.ucd_depositAddr
                }

                let ethBal = await lib.walletObj.getBalance(getEthBalParams);

                let estCostParams = {
                    coinType: nodeToken,
                    sender: transaction.ucd_depositAddr,
                    recipient: tokenColdWallet,
                    amount: transaction.ucd_amount
                }

                let estEthCost = await lib.walletObj.estimateEtherCost(estCostParams);

                // If ethereum in wallet not enough to fund transfer to cold wallet
                if (parseFloat(ethBal) < parseFloat(estEthCost)) {
                    // let message = "-W- Insufficient ethereum balance to sweep to cold wallet \nAmount: *" + ethBal + " ETH* \nEstimated Amount Required: *" + estEthCost + " ETH*\nOrder ID: *" + transaction.orderId + "*"
                    // await lib.bot.sendMonGrpMessage(message);
                    await transaction.update({
                        status: "OPEN"
                    })
                    next = true
                    continue
                }

                let sendParams = {
                    coinType: nodeToken,
                    sender: transaction.ucd_depositAddr,
                    recipient: tokenColdWallet,
                    amount: transaction.ucd_amount
                }

                res = await lib.walletObj.sendTransaction(sendParams);

                if (res.skip) {
                    console.log("-I- Skipping " + transaction.ucd_node + " " + transaction.ucd_token + " sweep to cold wallet: ", transaction.ucd_depositId)
                    next = true
                    continue
                }

                await transaction.update({
                    ucd_destinationAddr: tokenColdWallet,
                    ucd_status: "PENDING",
                    ucd_txid: res
                });
            } //end of fundedEthTxs.forEach


        } catch (err) {
            log.error("-E[7]- " + err)
            throw err;
        }

        return resolve();

    });
} //end of push_eth_deposits_job

//Push all scheduled OPEN deposit transactions.
async function push_usdt_omni_deposit_job() {

    push_usdt_omni_deposit_flag = false;
    await delay(60000); //so that it doesn't flood DB with queries.
    return new Promise(async(resolve, reject) => {

        try {

            let openTxs = await SQL.usdt_clear_deposits
                .findAll({
                    where: {
                        ucd_status: "OPEN",
                        ucd_node: "OMNI"
                    }

                });

            if (openTxs.length < 1) {
                return resolve()
            }

            for (let transaction of openTxs) {

                let forcePush = false;
                let next = false //reset
                let nodeToken = transaction.ucd_node + '_' + transaction.ucd_token;

                // Check if user has switched on force push
                let user = SQL.users.findOne({
                    where: {
                        merchantId: transaction.ucd_merchantId,
                        isActive: true
                    }
                });

                if (user == null) {
                    log.error("-E- Merchant ID not found. Unable to push transaction");
                    next = true
                    continue;
                }

                forcePush = user.forceTx;

                let params = {
                    coinType: nodeToken
                }

                let feeUSD = await lib.walletObj.estimateFee(params);

                if (!forcePush && feeUSD > lib.CONFIG.MAX_SEND_FEE) {
                    log.info("Deposit push tx paused, fee exceeds: " + lib.CONFIG.MAX_SEND_FEE + ". current: " + feeUSD)
                    next = true
                    continue
                }

                // Funder is only used for OMNI Transactions
                let funderAddr = lib.CONFIG.WALLET_ADDR.FUNDER
                let coldWallet = lib.CONFIG.WALLET_ADDR.DESTADDR;

                //Executes sendUsdtTx until tx had been broadcasted.
                while (!next) {
                    //Just incase
                    if (transaction.ucd_amount == 0) {
                        next = true
                        break;
                    }

                    // Even if not OMNI address still add funder as it won't affect ETH sendTransaction
                    let params = {
                        coinType: nodeToken,
                        sender: transaction.ucd_depositAddr,
                        recipient: coldWallet,
                        amount: transaction.ucd_amount,
                        funder: funderAddr
                    }

                    res = await lib.walletObj.sendTransaction(params);

                    //check if auto_send is false
                    if (res.skip) {
                        console.log("-I- Skipping usdt omni_send deposit: ", transaction.ucd_id)
                        next = true;
                        break;
                    }

                    if (!isSufficient(res)) {
                        var message = "-W- Insufficient funder balance \nPayment: *" + transaction.ucd_depositAddr + "* \nId: *" + transaction.ucd_id + "*"
                            //await lib.bot.sendGrpMessage(message)
                        next = true;
                        break;
                    }

                    if (!res.error) {
                        await transaction.update({
                            ucd_destinationAddr: coldWallet,
                            ucd_funderAddr: funderAddr,
                            ucd_status: "PENDING",
                            ucd_txid: res
                        });

                        next = true;
                        break;
                    }
                }
            } //end of openTxs.forEach

        } catch (err) {
            throw err;
        }

        return resolve();

    })
} //end of push_usdt_omni_deposit_job

//Updates forwarded jobs that are PENDING to CONFIRMED
async function update_usdt_clear_job() {
    update_usdt_clear_flag = false;
    await delay(5000); //so that it doesn't flood DB with queries.
    return new Promise((resolve, reject) => {
        SQL.usdt_clear_batches
            .findAll({
                where: {
                    status: "PENDING"
                }
            })
            .then(pendingTxs => {
                if (pendingTxs.length < 1) {
                    return Promise.resolve()
                }
                let tempArr4 = [];

                pendingTxs.forEach(transaction => {

                    let nodeToken = transaction.node + '_' + transaction.token;

                    let params = {
                        coinType: nodeToken,
                        txid: transaction.txid
                    }

                    tempArr4.push(
                        // wallet.getTxDetail(transaction.txid).then(tx => {
                        lib.walletObj.getTransaction(params).then(async tx => {
                            if ((tx.confirmations >= lib.CONFIG.RECEIVE_CONF_NUM)) {
                                let currEpoch = Math.floor(new Date() / 1000)

                                let updateObj = {
                                    confirmedEpoch: currEpoch,
                                    sendFee: tx.fee
                                }

                                if (transaction.node == 'ETH') {
                                    updateObj.ethNonce = tx.nonce;
                                    updateObj.ethGasUsed = tx.gasUsed;
                                    updateObj.ethGasPrice = tx.gasPrice;
                                }

                                if (tx.valid) {
                                    updateObj.status = "SUCCESS";
                                } else {
                                    updateObj.status = "INVALID";
                                }

                                await transaction.update(updateObj);

                                await SQL.usdt_tx_batches.update({
                                    isProcessing: false
                                }, /* Columns to update */ {
                                    where: {
                                        merchantId: transaction.merchantId,
                                        node: transaction.node,
                                        token: transaction.token,
                                        paymentAddr: transaction.paymentAddr
                                    }
                                } /* where clause */ );
                            }
                        })
                        .catch(e => {
                            return Promise.reject("-E[8.0] " + e);
                        })
                    );
                });
                return Promise.all(tempArr4);
            })
            .then(() => {
                return resolve();
            })
            .catch(e => {
                log.error("-E[8.1]- " + e)
                return resolve()
            });
    });
} //end of update_usdt_clear_job

//Updates forwarded deposit jobs that are PENDING to CONFIRMED
async function update_usdt_pend_deposits_job() {

    try {

        update_usdt_pend_deposits_flag = false;
        await delay(5000); //so that it doesn't flood DB with queries.

        return new Promise(async(resolve, reject) => {

            let pendingTxs = await SQL.usdt_clear_deposits
                .findAll({
                    where: {
                        ucd_status: "PENDING"
                    }
                });

            if (pendingTxs.length < 1) {
                return resolve();
            }

            let tempArr4 = [];

            for (let transaction of pendingTxs) {

                let nodeToken = transaction.ucd_node + '_' + transaction.ucd_token;

                let params = {
                    coinType: nodeToken,
                    txid: transaction.ucd_txid
                }

                tempArr4.push(

                    lib.walletObj.getTransaction(params).then(async tx => {

                        if ((tx.confirmations >= lib.CONFIG.RECEIVE_CONF_NUM)) {

                            let currEpoch = Math.floor(new Date() / 1000)

                            let updateObj = {
                                ucd_confirmedEpoch: currEpoch,
                                ucd_sendFee: tx.fee
                            }

                            if (transaction.ucd_node == 'ETH') {
                                updateObj.ucd_ethNonce = tx.nonce;
                                updateObj.ucd_ethGasUsed = tx.gasUsed;
                                updateObj.ucd_ethGasPrice = tx.gasPrice;
                            }

                            if (tx.valid) {
                                updateObj.ucd_status = "SUCCESS";
                            } else {
                                updateObj.ucd_status = "INVALID";
                            }

                            await transaction.update(updateObj);

                            await SQL.merch_deposit_addrs.update({
                                mda_updatedAt: new Date(),
                                mda_isProcessing: false
                            }, {
                                where: {
                                    mda_merchantId: transaction.ucd_merchantId,
                                    mda_node: transaction.ucd_node,
                                    mda_token: transaction.ucd_token,
                                    mda_depositAddr: transaction.ucd_depositAddr
                                }
                            });
                        }
                    })
                    .catch(e => {
                        return Promise.reject("-E[8.0] " + e);
                    })

                );

            }

            await Promise.all(tempArr4);
            return resolve();

        });

    } catch (err) {
        throw err;
    }
} //end of update_usdt_pend_deposits_job

async function update_usdt_tx_batches() {
    update_usdt_tx_flag = false;
    await delay(5000)
        //only get addresses under 48 hours
    let currEpoch = Math.floor(new Date() / 1000)
    let epochRange = currEpoch - 172800 //172800 = 48 hours

    return new Promise((resolve, reject) => {
        SQL.usdt_tx_batches
            .findAll({
                where: {
                    status: "PENDING",
                    createdEpoch: {
                        [lib.Op.gt]: epochRange
                    }
                }
            })
            .then(pendingTxs => {
                if (pendingTxs.length < 1) {
                    return Promise.resolve()
                }
                var tempArr5 = [];
                var usdtReceived = 0
                pendingTxs.forEach(transaction => {

                    let nodeToken = transaction.node + '_' + transaction.token;

                    let params = {
                        coinType: nodeToken,
                        address: transaction.paymentAddr
                    }

                    tempArr5.push(
                            // wallet.computeUSDTReceivedSQL(transaction.paymentAddr).then(async usdtReceived => {
                            lib.walletObj.computeAddressReceivedSQL(params).then(async usdtReceived => {
                                //console.log(transaction.paymentAddr, usdtReceived)

                                if (parseFloat(usdtReceived) >= parseFloat(transaction.amount)) {
                                    transaction.update({
                                        confirmedEpoch: Math.floor(new Date() / 1000),
                                        status: "CONFIRMED"
                                    })
                                }
                            }).catch(e => {
                                return Promise.reject("-E[8]- " + e);
                            })
                        ) //end of tempArr5.push
                })
                return Promise.all(tempArr5)
            })
            .then(() => {
                return resolve();
            })
            .catch(e => {
                log.error("-E[9]- " + e)
                return resolve()
            })
    })
} // end of update_usdt_tx_batches

async function expire_usdt_tx_batches() {
    expire_usdt_tx_flag = false;
    await delay(5000)
        //only get addresses under 48 hours
    let currEpoch = Math.floor(new Date() / 1000)
    let epochRange = currEpoch - 172800 //172800 = 48 hours

    return new Promise((resolve, reject) => {
        SQL.usdt_tx_batches
            .update({
                status: "EXPIRED"
            }, {
                where: {
                    status: "PENDING",
                    createdEpoch: {
                        [lib.Op.lt]: epochRange
                    }
                }
            })
    })
} // end of expire_usdt_tx_batches


//Push all scheduled USDT withdrawal transactions.
async function push_withdrawals_job() {
    push_withdrawal_flag = false;
    await delay(5000); //so that it doesn't flood DB with queries.
    return new Promise((resolve, reject) => {
        SQL.withdrawals.findAll({
                where: {
                    status: "OPEN"
                }
            })
            .then(async(openTxs) => {
                if (openTxs.length < 1) {
                    return Promise.resolve()
                }

                for (let transaction of openTxs) {

                    // let forcePush = false;
                    var next = false //reset

                    let node = transaction.node;
                    let token = transaction.token;
                    let nodeToken = node + '_' + token;

                    let withdrawAddr = '';

                    if (node == 'OMNI') {
                        withdrawAddr = lib.CONFIG.WALLET_ADDR.WITHDRAW;
                    } else {
                        withdrawAddr = lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW;
                    }

                    //Executes sendUsdtTx until tx had been broadcasted.
                    next = false //reset

                    while (!next) {
                        //Just incase
                        if (transaction.amount == 0) {
                            next = true
                            continue
                        }

                        let params = {
                            coinType: nodeToken,
                            address: withdrawAddr
                        }

                        withdraw = await lib.walletObj.getBalance(params)

                        if (parseFloat(withdraw) < parseFloat(transaction.amount)) {

                            // Check if a warning was sent less than 300 seconds ago
                            let warningInterval = 300;
                            let prevWarning = await SQL.logs.findOne({
                                where: {
                                    log_type: 'BOT',
                                    log_cat1: 'WARNING',
                                    log_cat2: 'INSUFFICIENT_WITHDRAW',
                                    log_cat3: node,
                                    log_created_date: {
                                        [lib.Op.gt]: new Date(new Date() - warningInterval * 1000)
                                    }
                                }
                            });

                            // If no warning sent in last 300 seconds then send new warning
                            if (prevWarning == null) {

                                let totalOpenWithdrawals = await SQL.withdrawals.sum('amount', {
                                    where: {
                                        node: node,
                                        token: token,
                                        status: 'OPEN'
                                    }
                                });

                                let message = `- WARNING -\n Insufficient withdraw balance\n Amount: *${transaction.amount}* ${nodeToken}\n Id: *${transaction.withdrawalId}*\n Total Open Withdraw:\n *${totalOpenWithdrawals}* ${nodeToken}`;

                                await SQL.logs.create({
                                    log_type: 'BOT',
                                    log_cat1: 'WARNING',
                                    log_cat2: 'INSUFFICIENT_WITHDRAW',
                                    log_cat3: node,
                                    log_message: message,
                                    log_created_epoch: new Date()
                                });

                                await lib.bot.sendMonGrpMessage(message)
                                log.error("[3321]" + message)
                            }

                            next = true
                            continue
                        }

                        params = {
                            coinType: nodeToken,
                            sender: withdrawAddr,
                            recipient: transaction.destinationAddr,
                            amount: transaction.amount
                        }

                        console.log("-D- Withdrawing tx: ", params)
                        res = await lib.walletObj.sendTransaction(params);

                        //check if auto_send is false
                        if (res.skip) {
                            console.log("-I- Skipping usdt omni_send withdrawal: ", transaction.withdrawalId)
                            next = true
                            continue
                        }

                        if (!res.error) {
                            next = true
                            await transaction.update({
                                senderAddr: withdrawAddr,
                                status: "PENDING",
                                txid: res
                            })
                            console.log("-I- Withdraw tx: " + res + " WithdrawID: " + transaction.withdrawalId + " Type: " + nodeToken)
                        }


                        // if (!isSufficient(res)) {
                        //     var message = "-W- Insufficient withdraw balance \nAmount: *" + transaction.amount + " " + nodeToken + " \nId: *" + transaction.withdrawalId + "*"
                        //     log.error(message)
                        //     next = true
                        //     continue
                        // }

                    } // end of while loop
                } //end of openTxs.forEach

                return Promise.resolve()
            })
            .then(() => {
                return resolve();
            })
            .catch(e => {
                console.log(e);
                return resolve()
            })
    })
} //end of push_withdrawals_job

async function update_withdrawals_job() {
    update_withdrawal_flag = false;
    await delay(15000); //so that it doesn't flood DB with queries.
    return new Promise((resolve, reject) => {
        SQL.withdrawals.findAll({
                where: {
                    status: "PENDING"
                }
            })
            .then(pendingTxs => {
                if (pendingTxs.length < 1) {
                    return Promise.resolve()
                }
                let tempArr4 = [];
                pendingTxs.forEach(transaction => {

                    let nodeToken = transaction.node + '_' + transaction.token;

                    let params = {
                        coinType: nodeToken,
                        txid: transaction.txid
                    }

                    tempArr4.push(
                        // wallet.getTxDetail(transaction.txid).then(tx => {
                        lib.walletObj.getTransaction(params).then(async tx => {
                            if ((tx.confirmations >= lib.CONFIG.RECEIVE_CONF_NUM)) {
                                let currEpoch = Math.floor(new Date() / 1000)

                                let updateObj = {
                                    confirmedEpoch: currEpoch,
                                    sendFee: tx.fee
                                }

                                if (transaction.node == 'ETH') {
                                    updateObj.ethNonce = tx.nonce;
                                    updateObj.ethGasUsed = tx.gasUsed;
                                    updateObj.ethGasPrice = tx.gasPrice;
                                }

                                if (tx.valid) {
                                    updateObj.status = "SUCCESS";
                                } else if (!tx.valid) {
                                    //tx was reverted on blockchain and is invalid.
                                    updateObj.status = "OPEN";
                                    updateObj.txid = null;
                                    lib.bot.sendMonGrpMessage("-E[631]- Resending invalid withdrawal: " + transaction.withdrawalId + " require manual resend.")
                                } else {
                                    //status QUEUED for admin attention on failed withdrawal.
                                    updateObj.status = "QUEUED";
                                    updateObj.txid = null;
                                    lib.bot.sendMonGrpMessage("-E[632]- Failed withdrawal: " + transaction.withdrawalId + " Please investigate.")
                                }

                                await transaction.update(updateObj);
                            }
                        })
                        .catch(e => {
                            return Promise.reject("-E[11.0] " + e);
                        })
                    );
                });
                return Promise.all(tempArr4);
            })
            .then(() => {
                return resolve();
            })
            .catch(e => {
                log.error("-E[11.1]- " + e)
                return resolve()
            });
    })
} //end of update_withdrawals_job

//Notify Admin if funder/withdraw hot wallet low.
async function notify_balance() {
    notify_balance_flag = false

    try {

        let nodes = ['OMNI', 'ETH'];

        for (let node of nodes) {

            //declare
            let coldWallet = funderBtc = funderBtcUsd = 0;
            let params, withdrawAddr, coldAddr, link, currency, withdrawCurrencyBal, currencyPrice, withdrawCurrencyUsd = null;


            let token = 'USDT';
            let nodeToken = node + '_' + token;

            if (node == 'OMNI') {
                withdrawAddr = lib.CONFIG.WALLET_ADDR.WITHDRAW;
                coldAddr = lib.CONFIG.WALLET_ADDR.DESTADDR;
                link = OMNIEXP_LINK;
                currency = 'BTC';

            } else {
                withdrawAddr = lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW;
                coldAddr = lib.CONFIG.ETH_WALLET_ADDR.COLD;
                link = ETHUSDT_EXP_LINK;
                currency = 'ETH';
            }

            params = {
                coinType: nodeToken,
                address: withdrawAddr
            };

            let withdraw = await lib.walletObj.getBalance(params);

            params = {
                coinType: nodeToken,
                address: coldAddr
            };

            coldWallet = await lib.walletObj.getBalance(params)

            // Get price of BTC or ETH depending on nodeToken
            params = {
                coinType: nodeToken
            }

            currencyPrice = await lib.walletObj.getFeePrice(params);

            params = {
                coinType: node + '_' + currency,
                address: withdrawAddr
            }
            withdrawCurrencyBal = await lib.walletObj.getBalance(params);

            withdrawCurrencyUsd = parseFloat(currencyPrice * withdrawCurrencyBal).toFixed(2);

            if (node == 'OMNI') {

                params = {
                    coinType: 'OMNI_BTC',
                    address: lib.CONFIG.WALLET_ADDR.FUNDER
                }

                funderBtc = await lib.walletObj.getBalance(params);

                funderBtcUsd = parseFloat(currencyPrice * funderBtc).toFixed(2);

                //Check for FUNDER WALLET BTC
                if (funderBtcUsd < lib.CONFIG.MIN_HOT_WALLET_BTCUSD) {
                    var message =
                        "*-WARNING- Funder BTC Low!*\n" +
                        lib.CONFIG.WALLET_ADDR.FUNDER +
                        '\n[BTC ' + funderBtc + '](' + OMNIEXP_LINK + lib.CONFIG.WALLET_ADDR.FUNDER + ')' + ' (~' + funderBtcUsd + ' USD)'
                    await lib.bot.sendMonGrpMessage(message)
                }
            }

            //CHECK WITHDRAW WALLET Currency (BTC / ETH)
            if (withdrawCurrencyUsd < lib.CONFIG.MIN_HOT_WALLET_BTCUSD) {
                var message =
                    "*-WARNING- Withdrawer " + currency + " Low!*\n" +
                    withdrawAddr +
                    '\n[' + currency + ' ' + withdrawCurrencyBal + '](' + link + withdrawAddr + ')' + ' (~' + withdrawCurrencyUsd + ' USD)'
                await lib.bot.sendMonGrpMessage(message)
            }

            //CHECK WITHDRAW WALLET USDT
            if (withdraw < lib.CONFIG.MIN_HOT_WALLET_USDT) {
                var message =
                    "*-WARNING- Withdrawer USDT Low!*\n" +
                    withdrawAddr +
                    '\n[' + withdraw + ' USDT](' + link + withdrawAddr + ')'
                await lib.bot.sendMonGrpMessage(message)
            }

            let highWithdrawals = await SQL.db.query(`
                SELECT :withdraw - sum(amount) as withdrawDeficitAmt
                from withdrawals 
                where status = 'OPEN' and node = :node
            `, {
                replacements: {
                    withdraw: withdraw,
                    node: node
                },
                type: SQL.db.QueryTypes.SELECT
            });

            if (highWithdrawals[0].withdrawDeficitAmt < 0) {

                var message =
                    "*-WARNING- Withdraw Wallet Deficit Amount!*\n" +
                    'Deficit: ' + highWithdrawals[0].withdrawDeficitAmt + ' ' + nodeToken +
                    '\n[' + withdrawAddr + '](' + link + withdrawAddr + ')';

                await lib.bot.sendMonGrpMessage(message);
            }
        }
    } catch (err) {
        console.log(err);
    }

    //Delay 5 minutes before notifying again 300000
    await delay(900000)
} //end of notify_balance

//flags are to prevent cron from creating new promises before functions are complete
var update_usdt_tx_flag
var expire_usdt_tx_flag
var schedule_usdt_clear_flag, push_usdt_clear_flag, update_usdt_clear_flag, push_usdt_omni_deposit_flag
var push_withdrawal_flag, update_withdrawal_flag
var notify_balance_flag
var start_schedule_usdt_clear_epoch

//Declaration
//For Payment Gateway
update_usdt_tx_flag = expire_usdt_tx_flag = schedule_usdt_clear_flag = fund_eth_orders_flag = fund_eth_deposits_flag = update_eth_funded_flag = push_eth_orders_flag = push_eth_deposits_flag = push_usdt_clear_flag = update_usdt_clear_flag = push_usdt_omni_deposit_flag = update_usdt_pend_deposits_flag = true

//For Withdrawal Functions
push_withdrawal_flag = update_withdrawal_flag = true
    //For Admin Monitoring Functions
notify_balance_flag = true

//Schduled Functions at intervals of 1 minute
setInterval(async function() {
    update_sendFeeUsd()
    invalidateCode()
    checkNodeSynced()
}, 60000)

//Update estimated network fee at intervals of 3 mins.
setInterval(async function() {
    resetScheduleClearFlag()
    update_estimated_network_fees()
}, 180000)

//Telegram notify periodic system time.
setInterval(async function() {
    let now = new Date();
    now.setUTCHours(now.getUTCHours() + 8);
    await lib.bot.sendSysGrpMessage('*' + now.toUTCString().replace("GMT", "UTC +8") + '*');
}, (60 * 60 * 1000));

//Scheduled Non Interval Functions
let schedule = new CronJob({
    cronTime: "* * * * * *",
    onTick: function() {
        if (schedule_usdt_clear_flag) {
            //console.log("\x1b[33m%s\x1b[0m", '-I- schedule_usdt_clear...')
            schedule_usdt_clear_job()
                .then(() => {
                    schedule_usdt_clear_flag = true
                        //console.log("\x1b[33m%s\x1b[0m", '-I- Completed schedule_usdt_clear.')
                })
                .catch(e => {
                    schedule_usdt_clear_flag = true;
                    log.error("[3322]" + e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[3]-",
                        msg: "Failed in schedule_usdt_clear_job()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (fund_eth_orders_flag) {

            fund_eth_orders_job()
                .then(() => {
                    fund_eth_orders_flag = true;
                })
                .catch(e => {
                    fund_eth_orders_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[5]-",
                        msg: "Failed in fund_eth_orders_job()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (fund_eth_deposits_flag) {

            fund_eth_deposits_job()
                .then(() => {
                    fund_eth_deposits_flag = true;
                })
                .catch(e => {
                    fund_eth_deposits_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[5]-",
                        msg: "Failed in fund_eth_deposits_job()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (update_eth_funded_flag) {
            //console.log("\x1b[33m%s\x1b[0m", '-I- schedule_usdt_clear...')
            update_eth_funded_job()
                .then(() => {
                    update_eth_funded_flag = true
                        //console.log("\x1b[33m%s\x1b[0m", '-I- Completed schedule_usdt_clear.')
                })
                .catch(e => {
                    update_eth_funded_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[6]-",
                        msg: "Failed in update_eth_funded_job()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (push_eth_orders_flag) {

            push_eth_orders_job()
                .then(() => {
                    push_eth_orders_flag = true;
                })
                .catch(e => {
                    push_eth_orders_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[7]-",
                        msg: "Failed in push_eth_orders_job()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (push_eth_deposits_flag) {

            push_eth_deposits_job()
                .then(() => {
                    push_eth_deposits_flag = true;
                })
                .catch(e => {
                    push_eth_deposits_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[7]-",
                        msg: "Failed in push_eth_deposits_job()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (push_usdt_omni_deposit_flag) {
            push_usdt_omni_deposit_job()
                .then(() => {
                    push_usdt_omni_deposit_flag = true;
                })
                .catch(e => {
                    push_usdt_omni_deposit_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[12]-",
                        msg: "Failed in push_usdt_omni_deposit_job()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (push_usdt_clear_flag) {
            //console.log("\x1b[34m%s\x1b[0m", '-I- push_usdt_clear...')
            push_usdt_clear_job()
                .then(() => {
                    push_usdt_clear_flag = true;
                    //console.log("\x1b[34m%s\x1b[0m", '-I- Completed push_usdt_clear.');
                })
                .catch(e => {
                    push_usdt_clear_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[4]-",
                        msg: "Failed in push_usdt_clear_flag()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (update_usdt_clear_flag) {
            //console.log("\x1b[35m%s\x1b[0m", '-I- update_usdt_clear...')
            update_usdt_clear_job()
                .then(() => {
                    update_usdt_clear_flag = true;
                    //console.log("\x1b[35m%s\x1b[0m", "-I- Completed update_usdt_clear_job.");
                })
                .catch(e => {
                    update_usdt_clear_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[8.1]-",
                        msg: "Failed in update_usdt_clear_job()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (update_usdt_pend_deposits_flag) {
            update_usdt_pend_deposits_job()
                .then(() => {
                    update_usdt_pend_deposits_flag = true;
                })
                .catch(e => {
                    update_usdt_pend_deposits_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[8.1]-",
                        msg: "Failed in update_usdt_pend_deposits_job()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        /* //Disabled update_usdt_tx_batches job as push_usdt* job wll update usdt_tx_batches table.
                if (update_usdt_tx_flag) {
                    //console.log("\x1b[36m%s\x1b[0m", '-I- update_usdt_tx...')
                    update_usdt_tx_batches()
                        .then(() => {
                            update_usdt_tx_flag = true;
                            //console.log("\x1b[36m%s\x1b[0m", "-I- Completed update_usdt_tx.");
                        })
                        .catch(e => {
                            update_usdt_tx_flag = true;
                            log.error(e);
                            let params = {
                                type: "Cron",
                                cat1: "-E[9]-",
                                msg: "Failed in update_usdt_tx_batches()",
                                error: e
                            }
                            ErrorHandler.LogError(params);
                        })
                }
        */

        if (expire_usdt_tx_flag) {
            //console.log("\x1b[36m%s\x1b[0m", '-I- update_usdt_tx...')
            expire_usdt_tx_batches()
                .then(() => {
                    expire_usdt_tx_flag = true;
                    //console.log("\x1b[36m%s\x1b[0m", "-I- Completed update_usdt_tx.");
                })
                .catch(e => {
                    expire_usdt_tx_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[9]-",
                        msg: "Failed in expire_usdt_tx_batches()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (push_withdrawal_flag) {
            //console.log("\x1b[97m%s\x1b[0m", '-I- push_usdt_clear...')
            push_withdrawals_job()
                .then(() => {
                    push_withdrawal_flag = true;
                    //console.log("\x1b[97m%s\x1b[0m", '-I- Completed push_usdt_clear.');
                })
                .catch(e => {
                    push_withdrawal_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[10]-",
                        msg: "Failed in push_withdrawals_job()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (update_withdrawal_flag) {
            //console.log("\x1b[96m%s\x1b[0m", '-I- update_usdt_clear...')
            update_withdrawals_job()
                .then(() => {
                    update_withdrawal_flag = true;
                    //console.log("\x1b[96m%s\x1b[0m", "-I- Completed update_usdt_clear_job.");
                })
                .catch(e => {
                    update_withdrawal_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[11.1]-",
                        msg: "Failed in update_withdrawals_job()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

        if (notify_balance_flag) {
            notify_balance()
                .then(() => {
                    notify_balance_flag = true
                })
                .catch(e => {
                    notify_balance_flag = true;
                    log.error(e);
                    let params = {
                        type: "Cron",
                        cat1: "-E[7]-",
                        msg: "Failed in notify_balance()",
                        error: e
                    }
                    ErrorHandler.LogError(params);
                })
        }

    },
    timeZone: "Asia/Kuala_Lumpur"
})

schedule.start() // Comment out for -DEV- purposes