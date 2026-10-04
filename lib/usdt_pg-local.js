//TODO: Response may be slow for getTxInfo, if there are a ton of orders caused by computeUSDTReceived. Should opt for checking usdt_clear_batches for OPEN/PENDING + CONFIRMED orders to get received amount.
const wallet = require("./wallet-local.js")
const dashboard = require("./dashboard.js")
const lib = require("./lib.js")
const utility = require("./utility.js")
const log = require("./console_log.js")
const SQL = lib.SQL
const USDT = 31

//Fetch merchant obj from SQL based on apiKey
const fetchMerchant = async apiKey => {
    var merchantObj = {}

    try{
        let results = await SQL.db.query(`
            SELECT * from api_keys 
            join users on API_KEYS.MERCHANTID = users.MERCHANTID 
            where api_keys.apiKey = ? and api_keys.isActive = true and users.isActive = true
        `, 
        { replacements: [apiKey], type: SQL.db.QueryTypes.SELECT });
        
        if(results.length == 0){
            return {
                error: "Merchant or API Key is not Active"
            }
        }

        merchantObj = results[0];
        
    }catch(err){
        log.error(err)
        return {
            error: "Something went wrong"
        }
    }

    return merchantObj
} //end of fetchMerchant

//Count number of decimals in number.
Number.prototype.countDecimals = function() {
        if (Math.floor(this.valueOf()) === this.valueOf()) return 0
        return this.toString().split(".")[1].length || 0
    } //end of countDecimals

module.exports = {
    /**
     * Create USDT Payment Transaction
     * @param {orderId} The orderId provided by merchant
     * @param {amount} The USDT amount
     * @return {string} paymentAddr, orderId, amount, createdAt
     */
    createTx: async function(req, res) {
        var apiKey = req.headers.apikey
        var merchantId = null
        var orderId = req.body.orderId || null
        var amount = req.body.amount || null
        var node = req.body.node
        var token = req.body.token

        // Temporary to allow merchants to transition to new API
        if (!node){
            node = 'OMNI'
        }
        if (!token){
            token = 'USDT'
        }

        try{

            //check if Order ID & USDT amount is given by merchant.
            if (!orderId || !amount || parseFloat(amount) < lib.CONFIG.MIN_USDT_CREATE_TX_AMOUNT || !node || !token) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            // Order ID must be less than 255 chars
            if(orderId.length >= 255){
                res.status(400).json({
                    success: false,
                    message: "Order ID must be less than 255 characters."
                })
                return
            }

            //check for USDT amount to be within 8 decimals
            if (parseFloat(amount).countDecimals() > 8) {
                res.status(400).json({
                    success: false,
                    message: "Amount is only up to 8 decimals."
                })
                return
            }

            //get merchantId
            var merchantObj = await fetchMerchant(apiKey)
            if (merchantObj.error) {
                res.status(400).json({
                    success: false,
                    message: merchantObj.error
                })
                return
            }
            //Assign merchantId
            merchantId = merchantObj.merchantId            

            //check if orderId already existed in usdt_tx_batches for this particular merchant
            var result = await SQL.usdt_tx_batches.findAll({
                where: {
                    merchantId: merchantId,
                    orderId: orderId
                }
            }) //end of lib.SQL.ico_reqs.findAll

            if (result.length > 0) {
                res.status(400).json({
                    success: false,
                    message: "Order ID " + orderId + " already exist for merchant: " + merchantId
                })
                return
            }

            //We are ready to generate a new wallet address
            // var newAddress = await wallet.genWallet()

            let nodeToken = node + '_' + token;
            let newAddress = null;

            let params = {
                coinType: nodeToken
            }
            newAddress = await lib.walletObj.createAcc(params);


            //Assign wallet address.
            var address = newAddress.address;

            //get current epoch time
            var currEpoch = Math.floor(new Date() / 1000);

            await SQL.usdt_tx_batches.create({
                merchantId: merchantId,
                orderId: orderId,
                createdEpoch: currEpoch,
                amount: amount,
                balance: 0,
                confirmedEpoch: null,
                paymentAddr: address,
                status: "PENDING",
                node: node,
                token: token,
                createdByApiKey: apiKey
            });

            // Check if user is logged in and a web socket is connected
            if(lib.webSocket.isClientConnected(merchantId)){
                                                                    
                let latestOrders = await dashboard.getLatestOrders(merchantId);
                
                let emitJson = {
                    merchantId: merchantId,
                    data: latestOrders
                }

                lib.webSocket.emitLatestOrders(emitJson);
            }
            
            res.status(200).json({
                success: true,
                paymentAddr: address,
                orderId: orderId,
                amount: amount,
                node: node,
                token: token,
                createdAt: currEpoch
            });

            return;

        }catch(err){
            console.log(err);
            res.status(500).json({
                success: false,
                message: "Something went wrong, please try again later."
            });
            return;
        }

    }, //end of createTx

    /**
     * Get tx info
     * @param {orderId} The orderId provided by merchant (If none is provided, all tx will be returned.)
     * @return {string} orderId, merchantId, paymentAddr, amount, received, createdAt, confirmedEpoch
     */
    getTxInfo: async function(req, res) {
        var apiKey = req.headers.apikey
        var merchantId = null
        var orderId = req.body.orderId || null

        //declare
        var order = {}

        //get merchantId
        var merchantObj = await fetchMerchant(apiKey)
        if (merchantObj.error) {
            log.error(merchantObj.error)
            res.status(400).json({
                success: false,
                message: merchantObj.error
            })
            return
        }
        //Assign merchantId
        merchantId = merchantObj.merchantId

        //Determine wether to query all or single transaction detail, if orderId specified.
        //Single order details
        var queryObj = {
            where: {
                merchantId: merchantId,
                orderId: orderId
            }
        }
        if ((orderId === null) || (orderId == "")) {
            //All order details
            queryObj = {
                where: {
                    merchantId: merchantId
                }
            }
        }

        await SQL.usdt_tx_batches.findAll(queryObj).then(async txs => {
            if (txs.length < 1) {
                //Invalid order id or no transaction found.
                return
            }

            var tmpArr = []
            await txs.forEach(async tx => {
                
                let node = tx.node;
                let token = tx.token;
                let nodeToken = node + '_' + token;

                let params = {
                    coinType: nodeToken,
                    address: tx.paymentAddr
                }

                tmpArr.push(
                    lib.walletObj.computeAddressReceivedSQL(params).then(async(received) => {
                        //console.log(tx.paymentAddr, received)
                        order[tx.orderId] = {
                            node: node,
                            token: token,
                            status: tx.status,
                            paymentAddr: tx.paymentAddr,
                            amount: parseFloat(tx.amount).toFixed(2),
                            received: parseFloat(received).toFixed(2),
                            ipn_status: tx.ipn_status,
                            created: tx.createdEpoch,
                            confirmed: tx.confirmedEpoch
                        }
                    }).catch(e => {
                        log.error("E208:" + e)
                        res.status(500).json({
                            success: false,
                            message: "Something went wrong, please try again later."
                        })
                        return Promise.reject(e)
                    })
                )
            })
            return Promise.all(tmpArr)
        }).then(() => {
            res.status(200).json({
                success: true,
                merchantId: merchantId,
                transaction: order
            })
            return
        }).catch(e => {
            log.error("E226:" + e)
            res.status(500).json({
                success: false,
                message: "Something went wrong, please try again later."
            })
            return
        })
    }, //end of getTxInfo

    //Only two responses. INVALID or VERIFIED both at STATUS 200 OK
    validateIPN: async function(req, res) {

        var orderId = req.body.orderId || null
        var merchantId = req.body.merchantId || null
        var paymentAddr = req.body.paymentAddr || null
        var transactionAmt = req.body.transactionAmt || null
        var currentReceived = req.body.currentReceived || null
        var totalReceived = req.body.totalReceived || null
        // var isConfirmed = req.body.isConfirmed || null

        if (!orderId || !merchantId || !paymentAddr || !transactionAmt || !currentReceived || !totalReceived) {
            res.status(200).send("INVALID")
            return
        }
        
        // Check if amounts are numeric. Return invalid if not numeric
        if(isNaN(transactionAmt) || isNaN(currentReceived) || isNaN(totalReceived)){
            res.status(200).send("INVALID")
            return
        }

        //Query up DB
        await SQL.usdt_tx_batches
            .findOne({
                where: {
                    orderId: orderId,
                    merchantId: merchantId,
                    paymentAddr: paymentAddr
                }
            })
            .then(async txObj => {
                if (!txObj) {
                    res.status(200).send("INVALID")
                        //TODO: update usdt_tx_batches
                    return
                }

                //declarations
                var body = {}

                //prepare body (SEQUENCE matters!)
                body = {
                    orderId: txObj.orderId,
                    merchantId: txObj.merchantId,
                    paymentAddr: txObj.paymentAddr,
                    transactionAmt: parseFloat(txObj.amount).toFixed(8),
                    currentReceived: parseFloat(currentReceived).toFixed(8),
                    totalReceived: parseFloat(totalReceived).toFixed(8)
                }

                if (typeof req.body === "object") {
                    var post_body = JSON.stringify(req.body)
                    var body = JSON.stringify(body)
                    var validatorStr = ',"cmd":"_notify-validate"'
                        //check if string contains 'cmd:_notify-validate' at the end
                    if (post_body.endsWith(validatorStr + "}")) {
                        //validator string confirmed
                        //remove validator string so we could do comparison on body.
                        post_body = post_body.replace(validatorStr, "")
                            //check sequence of key value pairs.
                        if (post_body === body) {
                            await txObj
                            .update({
                                ipn_status: "VERIFIED" //SENT, VERIFIED, INVALID
                            }).then(() => {
                                SQL.db.query(`
                                    UPDATE ipn_history 
                                    set ipn_status = 'VERIFIED'
                                    where ipn_merchantId = ? 
                                    and ipn_orderId = ? 
                                    and ipn_paymentAddr = ?
                                    and ipn_currentReceived = ?
                                    and ipn_totalReceived = ?`,
                                {replacements: [txObj.merchantId, txObj.orderId, txObj.paymentAddr, currentReceived, totalReceived], type: SQL.db.QueryTypes.UPDATE}
                                ).catch(function(e){
                                    log.error('E309:' + e)
                                });
                            }).then(res.status(200).send("VERIFIED"))
                            .catch(e => {
                                log.error("E308:" + e)
                                return {
                                    error: e
                                }
                            }) //end of catch
                            
                            
                            return
                        }
                    }
                }
                
                await txObj
                    .update({
                        ipn_status: "INVALID" //SENT, VERIFIED, INVALID
                    }).then(() => {
                        SQL.db.query(`
                            UPDATE ipn_history 
                            set ipn_status = 'INVALID'
                            where ipn_merchantId = ? 
                            and ipn_orderId = ? 
                            and ipn_paymentAddr = ?`,
                        {replacements: [txObj.merchantId, txObj.orderId, txObj.paymentAddr], type: SQL.db.QueryTypes.UPDATE}
                        ).catch(function(e){
                            log.error('E310:' + e)
                        });
                    }).then(() => {
                        res.status(200).send("INVALID")
                    })
                    .catch(e => {
                        log.error("E325:" + e)
                        return {
                            error: e
                        }
                    }) //end of catch
                
                

                return {
                    error: "Invalid POST response."
                }
            }) //end of .then txObj
            .catch(e => {
                log.error("E335:" + e)
                return {
                    error: e
                }
            }) //end of catch
        return
    }, //end of validateIPN

    /**
     * Get estimated network fee
     */
    getEstimatedFee: async function(req, res) {

        var apiKey = req.headers.apikey
        var node = req.body.node
        var token = req.body.token

        // Temporary to allow merchants to transition to new API
        if (!node){
            node = 'OMNI'
        }
        if (!token){
            token = 'USDT'
        }

        //check if required params are passed in
        if (!apiKey || !node || !token) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }
        
        //get merchantId
        var merchantObj = await fetchMerchant(apiKey)
        if (merchantObj.error) {
            log.error(merchantObj.error)
            res.status(400).json({
                success: false,
                message: merchantObj.error
            })
            return
        }

        let nodeToken = node + '_' + token;

        try{
            let feeUsd = await dashboard.getMarkedUpFee(nodeToken);

            res.status(200).json({
                success: true,
                estimatedFee: parseFloat(feeUsd).toFixed(2)
            });
            return;
        }catch(e){
            log.error("E400:" + e);
            res.status(500).json({
                success: false,
                message: "Something went wrong, please try again later."
            })
            return;
        }

    }, //end of getEstimatedFee


    /**
     * Bulk withdraw
     */
    bulkWithdraw: async function(withdrawals, user) {

        try{
            var withdrawedTokens = [];
            var totalWithdrawals = {};

            for (let withdrawData of withdrawals) {
                let node = withdrawData.node;
                let token = withdrawData.token;
                let nodeToken = node + '_' + token;

                //check for empty amount
                if (withdrawData.amount <= 0 || withdrawData.amount == "") {
                    return {
                        status: 400,
                        returnObj: {
                            success: false,
                            message: "One of the amount is invalid or is zero. (" + withdrawData.withdrawalId + ")"
                        }
                    }
                }

                //check to see if BTC address is valid
                let valParams = {
                    coinType: nodeToken,
                    address: withdrawData.address
                }
                var valid = await lib.walletObj.validateAddr(valParams);
                
                if (!valid) {
                    return {
                        status: 400,
                        returnObj: {
                            success: false,
                            message: "One of the wallet addresses (" + withdrawData.address + ") is invalid."
                        }
                    }
                }

                // Check to see if withdrawal ID is unique to merchant
                var exists = await SQL.db.query(`
                    SELECT 1 from withdrawals where merchantId = ? and withdrawalId = ?
                `, {replacements: [user.merchantId, withdrawData.withdrawalId], type: SQL.db.QueryTypes.SELECT})

                if (exists.length > 0) {
                    return {
                        status: 400,
                        returnObj: {
                            success: false,
                            message: "One of the withdrawal IDs (" + withdrawData.withdrawalId + ") already exists."
                        }
                    }
                }

                if(totalWithdrawals[node] == undefined){
                    totalWithdrawals[node] = {};
                }

                if(totalWithdrawals[node][token] == undefined){
                    totalWithdrawals[node][token] = {
                        totalAmt: 0,
                        totalNetworkFee: 0,
                        totalWithdrawFee: 0,
                        nextWithdrawBal: 0,
                        count: 0
                    }

                    withdrawedTokens.push({
                        node: node,
                        token: token
                    });
                }
                
                totalWithdrawals[node][token].totalAmt += parseFloat(withdrawData.amount);
                totalWithdrawals[node][token].count++;
                // totalAmount += Number(parseFloat(withdrawData.amount).toFixed(2))
                // withdrawCount++
            }

            var withdrawObj = await dashboard.fetchWithdrawBal(user.merchantId)

            for(let data of withdrawedTokens){
                let node = data.node;
                let token = data.token;
                let nodeToken = node + '_' + token;

                let tokenAmount = totalWithdrawals[node][token].totalAmt;
                let tokenWithdrawCount = totalWithdrawals[node][token].count;
                let tokenWithdrawObj = withdrawObj[node][token];

                let withdrawableBal = tokenWithdrawObj.withdrawableBal
                let withdrawable = tokenWithdrawObj.balance
                let tokenChargedSendFees = tokenWithdrawCount * tokenWithdrawObj.estimatedTxFee;
                let tokenWithdrawFee = ( tokenAmount * user.withdraw_fee )
                let totalFees = tokenChargedSendFees + tokenWithdrawFee;

                totalWithdrawals[node][token].totalNetworkFee = tokenChargedSendFees;
                totalWithdrawals[node][token].totalWithdrawFee = tokenWithdrawFee;
                
                //check if merchant is trying to withdraw more than balance
                if ((withdrawable - (tokenAmount + Number(totalFees))) < 0) {
                    return {
                        status: 400,
                        returnObj: {
                            success: false,
                            withdrawableBal: withdrawableBal,
                            tokenAmount: tokenAmount,
                            fee: parseFloat(totalFees).toFixed(2),
                            estimatedTxFee: parseFloat(tokenWithdrawObj.estimatedTxFee).toFixed(2),
                            message: "Available " + token + " balance is insufficient, required: " + parseFloat(tokenAmount + Number(totalFees)).toFixed(2) + " " + token
                        }
                    }
                }
            }
            
            await user.update({
                isWithdrawing: true
            });

            let allMax = await lib.SQL.configs.findAll({
                where: {
                    conf_cat1 : "MAX_WITHDRAW"
                }
            });
        
            let maxDefaults = {};
            for(let mDefault of allMax){
                maxDefaults[mDefault.conf_cat2] = parseFloat(mDefault.conf_value)
            }
            
            // Do not commit to DB if error occurs within transaction
            await SQL.db.transaction(async function (t) {
                
                let promises = [];
                let i = 0;

                //Schedule all withdrawals from csv file
                for (let withdrawData of withdrawals) {
                    
                    i++;
                    let node = withdrawData.node;
                    let token = withdrawData.token;
                    let nodeToken = node + '_' + token;

                    let status = 'OPEN';
                    let amount = withdrawData.amount;

                    let withdrawalVerifyAmt = maxDefaults[token];

                    // If withdrawal amount is very high. Do not immediately push. Need to be verified by a human
                    if(amount > withdrawalVerifyAmt){
                        status = 'PEND_VERIFY';

                        let message =
                            "*-WARNING2- Large Bulk Withdrawal Detected!*\n" +
                            "User: " + user.orgName + "\n" +
                            "Total Amount: " + amount + " " + nodeToken + "\n" + 
                            "Max Auto Amt: " + withdrawalVerifyAmt + " " + token + "\n";
                        await lib.bot.sendMonGrpMessage(message);
                    }

                    // Get latest withdrawal balance data
                    let latestWithdrawObj = await dashboard.fetchWithdrawBal(user.merchantId)
                    walletBal = latestWithdrawObj[node][token];
                    
                    let tokenWithdrawObj = withdrawObj[node][token];

                    // const withdrawalId = lib.randomize('Aa0', 12)
                        //log.debug(walletBal.withdrawableBal + " " + amount)
                    if ((walletBal.withdrawableBal - amount) < 0) {
                        //Balance is insufficient, merchant must have somehow performed manual withdrawal while scheduling is not complete, or something bad happened.
                        log.error("E1273:bulkWithdrawal schedule breaks in between due to insufficient balance; merchant must have somehow performed manual withdrawal while scheduling is not complete, or something bad happened.")
                        break
                    }

                    //schedule withdrawal tx
                    let newPromise = SQL.withdrawals.create({
                        merchantId: user.merchantId,
                        withdrawalId: withdrawData.withdrawalId,
                        createdEpoch: Math.floor(new Date() / 1000),
                        node: node,
                        token: token,
                        amount: amount,
                        fee: user.withdraw_fee,
                        resellerFee: user.reseller_fee,
                        chargedSendFeeUsd: tokenWithdrawObj.estimatedTxFee,
                        destinationAddr: withdrawData.address,
                        status: status
                    }, {transaction: t});
                    
                    promises.push(newPromise);

                } //end of for loop
                
                return Promise.all(promises);

            }).then(async function (result) {
                //Done scheduling all withdrawals or break, release withdrawals lock.
                user.update({
                    isWithdrawing: false
                })
                
            }).catch(function (err) {
                
                console.log("-E-", err);
                //Done scheduling all withdrawals or break, release withdrawals lock.
                user.update({
                    isWithdrawing: false
                })

                throw err;
            });

            for(let data of withdrawedTokens){
                let node = data.node;
                let token = data.token;
                let nodeToken = node + '_' + token;
    
                tokenAmount = totalWithdrawals[node][token].totalAmt;
    
                let nextWithdrawBal = await dashboard.nextWithdrawBal(user.merchantId, user.withdraw_fee, tokenAmount, nodeToken);
                nextWithdrawBal = parseFloat(nextWithdrawBal[node][token]).toFixed(2);
    
                totalWithdrawals[node][token] = nextWithdrawBal;
            }
            // console.log(totalWithdrawals);
            return {
                status: 200,
                returnObj: {
                    success: true,
                    withdrawalData: totalWithdrawals,
                    message: "Bulk withdrawal confirmed, scheduling withdrawals."
                }
            }

        }catch(err){
            throw err;
        } 

    }, //end of bulkWithdraw

    /**
     * Method to bulk withdraw through API
     */
    autoBulkWithdraw: async function(req, res) {
        
        var apiKey = req.headers.apikey

        let result = await SQL.db.query(`
            SELECT case when 
                date_format(current_timestamp, '%H%i') >= autoWithdrawStart 
                and date_format(current_timestamp, '%H%i') <= autoWithdrawEnd 
            then 1 else 0 end as allowed
            from api_keys where apiKey = ?
        `, {replacements: [apiKey], type: SQL.db.QueryTypes.SELECT});
        
        if(!result[0].allowed){
            res.status(401).json({
                success: false,
                message: "Permission Denied"
            })
            return
        }

        //get merchantId
        var merchantObj = await fetchMerchant(apiKey);
        
        if (merchantObj.error) {
            log.error(user.error)
            res.status(400).json({
                success: false,
                message: merchantObj.error
            })
            return
        }

        let user = await SQL.users.findOne({where: { merchantId: merchantObj.merchantId } });

        // console.log(user);

        //check if withdraw job is still scheduling
        if (user.isWithdrawing) {
            res.status(400).json({
                success: false,
                message: "Previous withdrawal job is being scheduled, please wait for it to be completed."
            });
            return
        }
        
        if (!user.isVerified) {
            res.status(400).json({
                success: false,
                message: "User is not verified; Account verification required for withdrawal."
            })
            return
        }
        
        //check for file
        if ( (!req.files && !req.body.data) || !req.body.checksum ) {
            res.status(400).json({
                success: false,
                message: "No file selected or data for upload or no checksum specified."
            });
            return
        }
        
        var file = req.files.file || null
        var csvData = req.body.data || null
        var checksumClient = req.body.checksum
        var checksumServer = ''
        
        if(csvData != null){

            checksumServer = await lib.md5(csvData)
            
            if (checksumClient != checksumServer) {
                res.status(400).json({
                    success: false,
                    message: "Checksum value does not match."
                })
                return
            }
            
            let buff = new Buffer.from(csvData, 'base64');
            let jsonString = buff.toString('ascii');

            let withdrawals = [];

            try {
                withdrawals = JSON.parse(jsonString);
            } catch (e) {
                res.status(400).json({
                    success: false,
                    message: "Invalid JSON String Provided"
                })
                return;
            }

            // console.log(withdrawals);
            let arrAddresses = {};

            // Check for duplicate address
            // for(let withdrawData of withdrawals){

            //     if(arrAddresses[withdrawData.address] !== undefined){
            //         res.status(400).json({
            //             success: false,
            //             message: "One of the wallet addresses (" + withdrawData.address + ") is a duplicate and appears twice in the data."
            //         })
            //         return
            //     }

            //     arrAddresses[withdrawData.address] = 1;
            // }

            try{
                let result = await this.bulkWithdraw(withdrawals, user);

                res.status(result.status).json(result.returnObj);

                return;

            }catch(err){
                console.log(err);

                res.status(500).json({
                    success: false,
                    message: "Bulk withdrawal failed. Please try again later."
                });

                return;
            }

        }else{

            //check file type is csv
            if ((file == null) || (file.mimetype != 'text/csv' && file.mimetype != 'application/vnd.ms-excel')) {
                res.status(400).json({
                    success: false,
                    message: "Invalid file format, expect csv."
                })
                return
            }

            //prevent image upload of more than 5MB
            if (file.size > 2000000) {
                res.status(400).json({
                    success: false,
                    message: "CSV file size should not be larger than 2MB."
                });
                return
            }

            //create temp file from buffer since md5-file requires path to file
            var pathFile = '/tmp/' + checksumClient + '.csv'
            // if (lib.fs.existsSync(pathFile)) {
            //     log.debug("File already exists: " + pathFile)
            //     console.log('File Exists');
            // }else{

            let _this = this;

            var wstream = lib.fs.createWriteStream(pathFile)
            wstream.write(file.data, async() => {
                wstream.end()

                checksumServer = await lib.md5File.sync(pathFile)
            
                //check if file hash is the same
                //To ensure that file has not been tampered and file contains no missing or additional data.
                if (checksumClient != checksumServer) {
                    res.status(400).json({
                        success: false,
                        message: "Checksum value does not match."
                    })
                    return
                }

                var withdrawals = []
                var arrAddresses = [];
                
                lib.csv
                .fromPath(pathFile)
                .on("data", async function(data) {
                            
                    let withdrawalId = data[0];
                    let node = data[1];
                    let token = data[2];
                    let address = data[3];
                    let amount = Number(parseFloat(data[4]).toFixed(2));
                    
                    if(arrAddresses[address] == undefined){
                        arrAddresses[address] = 1;
                    }else{
                        arrAddresses[address]++;
                    }

                    withdrawals.push({
                        withdrawalId: withdrawalId,
                        node: node,
                        token: token,
                        address: address,
                        amount: amount
                    });

                }).on("end", async function() {

                    // Check for duplicate address
                    // for(let addr in arrAddresses){
                    //     if(arrAddresses[addr] > 1){
                    //         res.status(400).json({
                    //             success: false,
                    //             message: "One of the wallet addresses (" + addr + ") is a duplicate and appears twice in the CSV file."
                    //         })
                    //         return
                    //     }
                    // }

                    try{
                        let result = await _this.bulkWithdraw(withdrawals, user);
                        
                        res.status(result.status).json(result.returnObj);
        
                        return;
        
                    }catch(err){
                        console.log(err);
        
                        res.status(500).json({
                            success: false,
                            message: "Bulk withdrawal failed. Please try again later."
                        });
        
                        return;
                    }
                })
            });

                
            // }

            
        }

    }, //end of autoBulkWithdraw

    /**
     * Get pending transactions on blockchain
     */
    getPendingTx: async function(req, res) {

        var apiKey = req.headers.apikey

        //get merchantId
        var merchantObj = await fetchMerchant(apiKey)
        if (merchantObj.error) {
            log.error(merchantObj.error)
            res.status(400).json({
                success: false,
                message: merchantObj.error
            })
            return
        }

        let orderIds = req.body.orderIds;
        // let node = req.body.node;
        // let token = req.body.token;

        //check if Order ID & USDT amount is given by merchant.
        if (!orderIds || !Array.isArray(orderIds)) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        // let nodeToken = node + '_' + token;

        try{

            let orders = await SQL.usdt_tx_batches.findAll({where: {orderId: orderIds}});

            let pendingTx = {};

            for(let orderObj of orders){

                let node = orderObj.node;
                let token = orderObj.token;
                let nodeToken = node + '_' + token;

                let params = {
                    coinType: nodeToken,
                    address: orderObj.paymentAddr
                }
    
                let result = await lib.walletObj.getPendingTx(params);

                pendingTx[orderObj.orderId] = result;

                await utility.delay(2);
            }

            res.status(200).json({
                success: true,
                result: pendingTx
            });
            return;
        }catch(e){
            log.error("E500:" + e);
            res.status(500).json({
                success: false,
                message: "Something went wrong, please try again later."
            })
            return;
        }

    }, //end of getPendingTx

    /**
     * Get Merchant Info
     */
    getMerchantInfo: async function(req, res) {

        var apiKey = req.headers.apikey

        //get merchantId
        var merchantObj = await fetchMerchant(apiKey);

        if (merchantObj.error) {
            log.error(merchantObj.error)
            res.status(400).json({
                success: false,
                message: merchantObj.error
            })
            return
        }

        try{

            let walletObj = {};

            let walletResult = await dashboard.fetchWithdrawBal(merchantObj.merchantId);

            for(let node in walletResult){
                walletObj[node] = {};

                let tokenResults = walletResult[node];

                for(let token in tokenResults){

                    let tokenData = tokenResults[token];

                    let totalFeesCharged = parseFloat(tokenData.totalOrderFees) 
                        + parseFloat(tokenData.totalDepositFees)
                        + parseFloat(tokenData.totalWithdrawalFees)
                        + parseFloat(tokenData.totalOrderSendFees)
                        + parseFloat(tokenData.totalDepositSendFee)
                        + parseFloat(tokenData.totalWithdrawalSendFees);

                    let tokenObj = {
                        withdrawableBal: tokenData.withdrawableBal,
                        totalDeposits: tokenData.totalOrdersAmt,
                        totalWithdrawals: tokenData.totalWithdrawAmt,
                        totalFeesCharged: totalFeesCharged.toFixed(2)
                    }

                    walletObj[node][token] = tokenObj;
                }
            }

            res.status(200).json({
                success: true,
                ipn: merchantObj.ipn_url,
                wallet: walletObj
            })

            return;

        }catch(e){
            console.log(e);
            log.error("E500:" + e);
            res.status(500).json({
                success: false,
                message: "Something went wrong, please try again later."
            })
            return;
        }

    }, //end of getMerchantInfo

    // LATEST MERCHANT INFO API 
    //
    // /**
    //  * Get Merchant Info
    //  */
    // getMerchantInfo: async function(req, res) {

    //     var apiKey = req.headers.apikey

    //     //get merchantId
    //     var merchantObj = await fetchMerchant(apiKey)
    //     if (merchantObj.error) {
    //         log.error(merchantObj.error)
    //         res.status(400).json({
    //             success: false,
    //             message: merchantObj.error
    //         })
    //         return
    //     }

    //     try{

    //         let walletObj = {};

    //         let walletResult = await dashboard.fetchWithdrawBal(merchantObj.merchantId);

    //         // console.log(walletResult);

    //         for(let node in walletResult){
    //             walletObj[node] = {};

    //             let tokenResults = walletResult[node];

    //             for(let token in tokenResults){

    //                 let tokenData = tokenResults[token];

    //                 let totalPaymentGatewayFees = parseFloat(tokenData.totalOrderFees) 
    //                     + parseFloat(tokenData.totalDepositFees)
    //                     + parseFloat(tokenData.totalWithdrawalFees);

    //                 let tokenObj = {
    //                     withdrawableBal: tokenData.withdrawableBal,
    //                     totalOrders: tokenData.totalOrdersAmt,
    //                     totalDeposits: tokenData.totalDepositAmt,
    //                     totalWithdrawals: tokenData.totalWithdrawAmt,
    //                     totalOrderNetworkFees: tokenData.totalOrderSendFees,
    //                     totalDepositNetworkFees: tokenData.totalDepositSendFee,
    //                     totalWithdrawNetworkFees: tokenData.totalWithdrawalSendFees,
    //                     totalPaymentGatewayFees: totalPaymentGatewayFees
    //                 }

    //                 walletObj[node][token] = tokenObj;
    //             }
    //         }

    //         res.status(200).json({
    //             success: true,
    //             ipn: merchantObj.ipn_url,
    //             wallet: walletObj
    //         })

    //         return;

    //     }catch(e){
    //         console.log(e);
    //         log.error("E500:" + e);
    //         res.status(500).json({
    //             success: false,
    //             message: "Something went wrong, please try again later."
    //         })
    //         return;
    //     }

    // }, //end of getMerchantInfo

}