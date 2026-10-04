const lib = require('./lib.js')
const wallet = require('./wallet-local.js')
const admin = require('./admin.js')
const SQL = lib.SQL
const OMNIEXP_LINK = 'https://omniexplorer.info/address/';
const ETHUSDT_EXP_LINK = "https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7?a=";


//numbers with commas
function nbr(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

//Telegram-specific requirements
const {
    TelegramClient
} = require('messaging-api-telegram')
const client = TelegramClient.connect(lib.CONFIG.TELEGRAM.KEY);
const auto_send = lib.CONFIG.TELEGRAM.STATUS

async function groupReportStats(chatId = lib.CONFIG.TELEGRAM.GROUP_ADMIN) {


    try{

        let clearObj = await admin.fetchAllClearedAmount()
        
        let nodes = ['OMNI', 'ETH'];

        for(let node of nodes){

            let earnings = parseFloat((Number(clearObj[node].pgFees) + Number(clearObj[node].withdrawFee))).toFixed(2)

            let message = '=== *' + node + '* ===\n' +
            '*Transacted:* ' + nbr(clearObj[node].cleared.toFixed(2)) + ' USDT\n' +
            '===Revenue===\n' +
            '*PG Fees:* ' + clearObj[node].pgFees.toFixed(2) + ' USDT\n' +
            '*Withdraw:* ' + clearObj[node].withdrawFee.toFixed(2) + ' USDT\n' +
            '===Costs===\n' +
            '*Sending Fees:*\n ' + clearObj[node].sendFee.toFixed(8) + ' (~' + clearObj[node].sendFeeUsd.toFixed(2) + ' USD)\n' +
            '*Withdraw Fees:*\n ' + clearObj[node].withdrawCost.toFixed(8) + ' (~' + clearObj[node].withdrawCostUsd.toFixed(2) + ' USD)\n' +
            '===Earnings===\n' +
            '*Earnings:*\n ~' + nbr(earnings) + ' USD\n' +
            '*Estimated Earnings:*\n ~' + nbr(clearObj[node].estEarnings.toFixed(2)) + ' USD\n';

            if (lib.CONFIG.RUN == "development") {
                message = "DEVELOPMENT DATA\n" + message
            }
        
            if (auto_send) {

                client.sendMessage(chatId, message, {
                    disable_web_page_preview: true,
                    disable_notification: true,
                    parse_mode: 'markdown'
                }).then((response) => {
                    //console.log(response)
                }).catch((e) => {
                    console.log("-E- " + e)
                }) //end of catch
            }

        }

    }catch(err){
        console.log(err);
    }
    
}

async function groupReportBal(chatId = lib.CONFIG.TELEGRAM.GROUP_ADMIN) {
    await sendGrpMessage("Computing balances, please wait for a moment...")

    try{

        let nodes = ['OMNI', 'ETH'];

        for(let node of nodes){

            //declare
            let funderBtc, funderBtcUsd = walletBtcBal = walletBtcBalUsd = totalOpenWithdrawalAmt = 0;
            let coldWallet = 0;
            let params, withdrawAddr, coldAddr, link, currency, withdrawCurrencyBal, currencyPrice, withdrawCurrencyUsd = null;
            
            let token = 'USDT';
            let nodeToken = node + '_' + token;

            if (node == 'OMNI'){
                withdrawAddr = lib.CONFIG.WALLET_ADDR.WITHDRAW;
                coldAddr = lib.CONFIG.WALLET_ADDR.DESTADDR;
                link = OMNIEXP_LINK;
                currency = 'BTC';
                
            }else{
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

            coldWallet = await lib.walletObj.getBalance(params);
            // coldWallet = await wallet.fetchUsdtBal(lib.CONFIG.WALLET_ADDR.DESTADDR)
            // withdraw = await wallet.fetchUsdtBal(lib.CONFIG.WALLET_ADDR.WITHDRAW)
            

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

            if (node == 'OMNI'){

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

                // Unconsolidated for OMNI
                params = {
                    coinType: 'OMNI_BTC'
                }
                walletBtcBal = await lib.walletObj.getWalletTotal(params);

                if (walletBtcBal < 0) {
                    walletBtcBal = 0
                }
                walletBtcBal = walletBtcBal - funderBtc - withdrawCurrencyBal;

                walletBtcBalUsd = parseFloat(currencyPrice * walletBtcBal).toFixed(2);
            }


            totalOpenWithdrawalAmt = await SQL.db.query(`
                SELECT sum(ifnull(amount, 0)) as totalOpenWithdrawalAmt
                from withdrawals 
                where status = 'OPEN' and node = :node
            `, {
                    replacements: {node: node},
                    type: SQL.db.QueryTypes.SELECT
                })
            
            totalOpenWithdrawalAmt = Number(totalOpenWithdrawalAmt[0].totalOpenWithdrawalAmt || '0.00').toFixed(4);

            

            let funderMsg = (node == 'OMNI') ? '*Funder(Hot):*\n[' + currency + ' ' + funderBtc + '](' + link + lib.CONFIG.WALLET_ADDR.FUNDER + ')' + ' (~' + funderBtcUsd + ' USD)\n' : '';
            let unconsolidatedMsg = (node == 'OMNI') ? '*Unconsolidated:* ' + parseFloat(walletBtcBal).toFixed(8) + ' ' + currency + ' (~' + walletBtcBalUsd + ' USD)' : '';

            var message =
                '===== ' + node + ' Wallets =====\n' +
                '*Cold:* [' + nbr(parseFloat(coldWallet).toFixed(2)) + ' USDT]' +
                '(' + link + coldAddr + ')\n' +
                '*Withdraw(Hot):*\n[' + nbr(parseFloat(withdraw).toFixed(2)) + ' USDT]' +
                '(' + link + lib.CONFIG.WALLET_ADDR.WITHDRAW + ')\n[' + withdrawCurrencyBal + ' ' + currency + '](' + link + withdrawAddr + ')' + ' (~' + withdrawCurrencyUsd + ' USD)\n' +
                '*Open Withdrawals:*\n[' + parseFloat(totalOpenWithdrawalAmt).toFixed(2) + ' USDT]\n' +
                funderMsg +
                unconsolidatedMsg

            if (lib.CONFIG.RUN == "development") {
                message = "DEVELOPMENT DATA\n" + message
            }

            if (auto_send) {
                var res = sendGrpMessage(message)
                if (res.error !== undefined) {
                    return res
                }
            }    
        }
    }catch(err){
        console.log(err);
    }
}

//Used to send in periodic message.
async function sendSysGrpMessage(message, chatId = lib.CONFIG.TELEGRAM.GROUP_SYSTEM) {
    if (auto_send) {
        client.sendMessage(chatId, message, {
                disable_web_page_preview: true,
                disable_notification: true,
                parse_mode: 'markdown'
            }).then((response) => {
                //console.log(response)
            }).catch((e) => {
                console.log("-E- " + e)
                return {
                    error: e
                }
            }) //end of catch
    }
    return true
}

//NOTE: sendMOnGrp Message has parse_mode commented out because some withdraw id has markdown syntax such as "_" which messes up when parse mode is enabled.
//Used to send in monitoring messages.
async function sendMonGrpMessage(message, chatId = lib.CONFIG.TELEGRAM.GROUP_MONITOR) {
    if (auto_send) {
        client.sendMessage(chatId, message, {
                disable_web_page_preview: true,
                disable_notification: true,
                //parse_mode: 'markdown'
            }).then((response) => {
                //console.log(response)
            }).catch((e) => {
                console.log("-E- " + e)
                return {
                    error: e
                }
            }) //end of catch
    }
    return true
}

//Used in sending system admin messages for reporting purposes.
async function sendGrpMessage(message, chatId = lib.CONFIG.TELEGRAM.GROUP_ADMIN) {
    if (auto_send) {
        client.sendMessage(chatId, message, {
                disable_web_page_preview: true,
                disable_notification: true,
                parse_mode: 'markdown'
            }).then((response) => {
                //console.log(response)
            }).catch((e) => {
                console.log("-E- " + e)
                return {
                    error: e
                }
            }) //end of catch
    }
    return true
}

async function listen() {
    var offset = null //declare
    while (true) {
        await SQL.telegram_bots.findOne({
                where: {
                    update_id: {
                        [lib.Op.ne]: null
                    }
                }
            }).then(async id => {
                offset = Number(id.update_id) + 1
                await client.getUpdates({
                        offset: offset,
                        limit: 100,
                    }).then(async(response) => {
                        if (response.length < 1) {
                            return Promise.resolve
                        }
                        await response.forEach(async updates => {
                            if (updates.message == undefined) {
                                return
                            }
                            if ((updates.message['chat'].id == lib.CONFIG.TELEGRAM.GROUP_ADMIN) && (updates.message['text'] != undefined)) {
                                if (updates.message['text'] == "/stats") {
                                    await groupReportStats()
                                }

                                if (updates.message['text'] == "/balance") {
                                    await groupReportBal()
                                }

                                if (updates.message['text'] == "/deficit") {
                                    await groupReportDeficit()
                                }
                            }
                        })
                        await id.update({
                            update_id: response[response.length - 1].update_id
                        })
                    }).catch((e) => {
                        console.log("-E- " + e)
                    }) //end of catch
            }) //end of client.getUpdates
    }
} //end of listen


//Listens and responds to command in group.
listen()

module.exports = {
    sendGrpMessage: async function(message, chatId = lib.CONFIG.TELEGRAM.GROUP_ADMIN) {
        return await sendGrpMessage(message, chatId)
    },

    sendSysGrpMessage: async function(message, chatId = lib.CONFIG.TELEGRAM.GROUP_SYSTEM) {
        return await sendSysGrpMessage(message, chatId)
    },

    sendMonGrpMessage: async function(message, chatId = lib.CONFIG.TELEGRAM.GROUP_MONITOR) {
        return await sendMonGrpMessage(message, chatId)
    }
}