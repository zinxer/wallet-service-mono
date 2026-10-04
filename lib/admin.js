const lib = require('./lib.js')
const utility = require("./utility.js")
const dashboard = require('./dashboard.js');
const aws = require("./aws.js");
const SQL = lib.SQL
const log = require("./console_log.js")


const getUserList = async() => {
    var userListObj = null;
    
    await SQL.db.query(`
        SELECT * from users where ISADMIN = FALSE`, 
        { type: SQL.db.QueryTypes.SELECT}
    ).then(async(results) => {
        
        userListObj = results;

    }).catch((e) => {
        return {
            error: e
        }
    });

    return userListObj;
} //end of getUserList

async function fetchTotalWithdrawFee() {

    let retObj = {}

    try{

        let nodes = ['OMNI', 'ETH'];

        for(let node of nodes){
            retObj[node] = {};
            retObj[node]['withdrawFee'] = 0;
            retObj[node]['withdrawCostUsd'] = 0;
            retObj[node]['withdrawCost'] = 0;
        }
    
        let withdrawals = await SQL.withdrawals.findAll({
            where: {
                status: "SUCCESS"
            }
        });
    
        for (let withdraw of withdrawals){
            retObj[withdraw.node]['withdrawFee'] += parseFloat(withdraw.amount * ( withdraw.fee - withdraw.resellerFee ))
            retObj[withdraw.node]['withdrawCostUsd'] += parseFloat(withdraw.sendFeeUsd)
            retObj[withdraw.node]['withdrawCost'] += parseFloat(withdraw.sendFee)
        }

        return retObj;

    }catch(err){
        console.log(err);
    }

} //end of fetchTotalWithdrawFee


module.exports = {

    getAllUsers: async function(req, res) {

        //Check if user is admin
        const user = await dashboard.getUser(req)
        if (user == undefined) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        if (!user.isAdmin) {
            res.status(403).json({
                success: false,
                message: "You do not have admin privileges to this endpoint."
            })
            return
        }

        var userListObj = {}

        try{
            userListObj = await getUserList();

            for(let key in userListObj){
                let withdrawBalObj = await dashboard.fetchWithdrawBal(userListObj[key].merchantId);
                
                userListObj[key].withdrawData = withdrawBalObj;
            }
        }catch(error){
            res.status(400).json({
                success: false,
                message: "Something went wrong, please try again later."
            })
            return
        }

        res.status(200).json({
            success: true,
            data: userListObj
        })
    }, //end of getAllUsers

    registerUser: async function(req, res) {

        //Check if user is admin
        const user = await dashboard.getUser(req)
        if (user == undefined) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        if (!user.isAdmin) {
            res.status(400).json({
                success: false,
                message: "You do not have admin privileges to this endpoint."
            })
            return
        }

        var name = req.body.name || null
        var email = req.body.email || null
        var password = req.body.password || null
        var orgName = req.body.orgName || null

        if (!name || !email || !password || (typeof password != 'string') || (typeof name != 'string') || (typeof email != 'string')) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        //Check if user already exists in DB
        await SQL.users.findOne({
                where: {
                    email: email
                }
            }).then((user) => {
                if (user) {
                    //user already exist, return
                    res.status(400).json({
                        success: false,
                        message: "Account already exist."
                    })
                    return
                }

                //User does not exist, register user!
                //encrypt password first
                lib.bcrypt.hash(password, lib.CONFIG.SALT_ROUNDS, async function(err, hash) {
                        if (err) {
                            console.log(err)
                            res.status(400).json({
                                success: false,
                                message: {
                                    "error": "Something went wrong, unable to signup merchant."
                                }
                            })
                            return
                        } //end of if err

                        merchantId = await lib.uniqid.time()
                            //console.log(merchantId)
                        await SQL.users.create({
                                merchantId: merchantId,
                                name: name,
                                email: email,
                                password: hash,
                                orgName: orgName,
                                createdEpoch: Math.floor(new Date() / 1000)
                            }).then(async(create) => {
                                await SQL.users.findOne({
                                        where: {
                                            merchantId: merchantId
                                        }
                                    }).then(async(queriedUser) => {
                                        //send account verification link
                                        dashboard.sendVeriLink(queriedUser)
                                    }).catch((e) => {
                                        log.error(e)
                                        res.status(400).json({
                                            success: false,
                                            message: "Something went wrong, please try again later."
                                        })
                                        return
                                    }) //end of catch

                                res.status(200).json({
                                    success: true,
                                    email: email,
                                    message: "Successfully created account, please verify your email."
                                })
                            }).catch((e) => {
                                log.error(e)
                                res.status(400).json({
                                    success: false,
                                    message: "Something went wrong, please try again later."
                                })
                                return
                            }) //end of catch
                    }) //end of bcrypt

            }).catch((e) => {
                log.error(e)
                res.status(400).json({
                    success: false,
                    message: "Something went wrong, please try again later."
                })
                return
            }) //end of catch
    }, //end of registerUser

    fetchAllClearedAmount: async function() {

        try{

            let nodes = ['OMNI', 'ETH'];
            let retObj = {};

            for(let node of nodes){
                retObj[node] = {};
                retObj[node]['cleared'] = 0;
                retObj[node]['sendFeeUsd'] = 0;
                retObj[node]['sendFee'] = 0;
                retObj[node]['pgFees'] = 0;
                retObj[node]['estEarnings'] = 0;
                retObj[node]['withdrawFee'] = 0;
                retObj[node]['withdrawCostUsd'] = 0;
                retObj[node]['withdrawCost'] = 0;
            }

            let clearedTxs = await SQL.usdt_clear_batches.findAll({
                where: {
                    status: "SUCCESS"
                }
            });

            if (!clearedTxs || (clearedTxs.length < 1)) {
                return retObj;
            }

            for (let transaction of clearedTxs){
                
                retObj[transaction.node]['cleared'] += parseFloat(transaction.amount);
                retObj[transaction.node]['sendFeeUsd'] += parseFloat(transaction.sendFeeUsd);
                retObj[transaction.node]['sendFee'] += parseFloat(transaction.sendFee);
                retObj[transaction.node]['pgFees'] += parseFloat((transaction.amount * transaction.fee));               

            }

            let depositTxs = await SQL.usdt_clear_deposits.findAll({
                where: {
                    ucd_status: "SUCCESS"
                }
            });

            for (let transaction of depositTxs){

                retObj[transaction.ucd_node]['cleared'] += parseFloat(transaction.ucd_amount);
                retObj[transaction.ucd_node]['sendFeeUsd'] += parseFloat(transaction.ucd_sendFeeUsd);
                retObj[transaction.ucd_node]['sendFee'] += parseFloat(transaction.ucd_sendFee);
                retObj[transaction.ucd_node]['pgFees'] += parseFloat((transaction.ucd_amount * transaction.ucd_depositFee));

            }

            let withdraw = await fetchTotalWithdrawFee();
            
            for(let node of nodes){

                let estEarnings = await SQL.db.query(`
                    SELECT ( 
                        sum(usdt_clear_batches.amount * ( users.withdraw_fee - users.reseller_Fee ) )
                        - (select sum(amount * ( fee - resellerFee ) ) from withdrawals where node = :node ) 
                    ) as estimatedEarnings 
                    from usdt_clear_batches 
                    join users on usdt_clear_batches.merchantId = users.merchantId 
                    where usdt_clear_batches.status = 'SUCCESS' and usdt_clear_batches.node = :node
                `, {replacements: {node: node}, type: SQL.db.QueryTypes.SELECT});

                retObj[node]['estEarnings'] = Number(estEarnings[0].estimatedEarnings) || 0;
                

                let sumDeposits = await SQL.db.query(`
                    SELECT ( 
                        sum(usdt_clear_deposits.ucd_amount * ( users.withdraw_fee - users.reseller_Fee ) )
                    ) as estimatedEarnings 
                    from usdt_clear_deposits
                    join users on usdt_clear_deposits.ucd_merchantId = users.merchantId 
                    where usdt_clear_deposits.ucd_status = 'SUCCESS' and usdt_clear_deposits.ucd_node = :node
                `, {replacements: {node: node}, type: SQL.db.QueryTypes.SELECT});
                
                retObj[node]['estEarnings'] += (parseFloat(sumDeposits[0].estimatedEarnings) || 0);
                

                retObj[node]['withdrawFee'] = withdraw[node].withdrawFee;
                retObj[node]['withdrawCostUsd'] = withdraw[node].withdrawCostUsd;
                retObj[node]['withdrawCost'] = withdraw[node].withdrawCost;

            }

            return retObj;

        }catch(err){
            console.log(err);
        }
    }, //end of fetchAllClearedAmount

    manualPostIpnAdmin: async function(req, res) {
        //*****We will always need to verify and get user details thru this for ALL private endpoints****
        const user = await dashboard.getUser(req)
        if (user == undefined) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        if (!user.isAdmin) {
            res.status(400).json({
                success: false,
                message: "You do not have admin privileges to this endpoint."
            })
            return
        }
        
        var ipnId = req.body.ipnId || null
        var merchantId = req.body.merchantId || null

        if (!ipnId || !merchantId) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        try{
            let transaction = await SQL.db.query(`
                SELECT * from usdt_tx_batches join ipn_history on orderId = ipn_orderId where ipn_id = ? and merchantId = ?`, 
            {replacements: [ipnId, merchantId], type: SQL.db.QueryTypes.SELECT})

            transaction = transaction[0];

            for (i = 1; i <= 5; i++) { 
                let result = await dashboard.ipn_post(transaction, transaction.ipn_currentReceived, transaction.ipn_totalReceived);
                if(result === true){
                    res.status(200).json({
                        success: true,
                        ipn_success: false,
                        message: "Completed resend IPN with SUCCESSFUL response"
                    })
                    return;
                }
                await utility.delay(5000);
            }
    
            res.status(200).json({
                success: true,
                ipn_success: true,
                message: "Completed resend IPN with NO response or UNSUCCESSFUL response"
            })
            return

        }catch(e){
            console.log(e);
            res.status(400).json({
                success: false,
                message: "Something went wrong. Please try again later."
            })
        }

        
        
    }, //end of manualPostIpnAdmin

    getTotalWithdrawableAmt: async function(req, res, type) {

        //*****We will always need to verify and get user details thru this for ALL private endpoints****
        const user = await dashboard.getUser(req)
        if (user == undefined) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        if (!user.isAdmin) {
            res.status(400).json({
                success: false,
                message: "You do not have admin privileges to this endpoint."
            })
            return
        }
        
        try{
            let totalWithdrawableAmt = 0;
    
            let merchants = await SQL.db.query(`SELECT merchantId from users`, 
            { type: SQL.db.QueryTypes.SELECT }
            );
    
            let arrPromise = []; 
    
            merchants.forEach(row => {
                let merchantId = row.merchantId;
                
                arrPromise.push(dashboard.fetchWithdrawBal(merchantId));
            }); 
    
            let results = await Promise.all(arrPromise);

            results.forEach(row => {
                totalWithdrawableAmt += parseFloat(row.withdrawableBal);
            });

            res.status(200).json({
                success: true,
                totalWithdrawableAmt: parseFloat(totalWithdrawableAmt).toFixed(2)
            });
            return;
    
        }catch(e){
            console.log(e);
            res.status(400).json({
                success: false,
                message: "Something went wrong please try again later."
            })
        }

    }, //end of getTotalWithdrawableAmt

    getWithdrawalsToVerify: async function(req, res, type) {

        //*****We will always need to verify and get user details thru this for ALL private endpoints****
        const user = await dashboard.getUser(req)
        if (user == undefined) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        if (!user.isAdmin) {
            res.status(400).json({
                success: false,
                message: "You do not have admin privileges to this endpoint."
            })
            return
        }
        
        try{
            let arrPendingVerify = [];
            
            let pendingWithdrawals = await SQL.withdrawals.findAll({
                where: {
                    status: 'PEND_VERIFY'
                },
                order: [['createdEpoch', 'ASC']],
                raw: true
            })

            for(let withdrawalData of pendingWithdrawals){

                arrPendingVerify.push({
                    merchantId: withdrawalData.merchantId,
                    withdrawalId: withdrawalData.withdrawalId,
                    node: withdrawalData.node,
                    token: withdrawalData.token,
                    amount: parseFloat(withdrawalData.amount).toFixed(2),
                    fee: ( parseFloat(withdrawalData.amount) * parseFloat(withdrawalData.fee) ).toFixed(2),
                    destinationAddr: withdrawalData.destinationAddr,
                    senderAddr: withdrawalData.senderAddr,
                    status: withdrawalData.status,
                    chargedSendFeeUsd: parseFloat(withdrawalData.chargedSendFeeUsd).toFixed(2),
                    createdAt: withdrawalData.createdAt,
                });

            }

            res.status(200).json({
                success: true,
                data: arrPendingVerify
            });

            return;
    
        }catch(e){
            console.log(e);
            res.status(400).json({
                success: false,
                message: "Something went wrong please try again later."
            })
        }

    }, //end of getWithdrawalsToVerify

    updateWithdrawalStatus: async function(req, res, type) {

        //*****We will always need to verify and get user details thru this for ALL private endpoints****
        const user = await dashboard.getUser(req)
        if (user == undefined) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        if (!user.isAdmin) {
            res.status(400).json({
                success: false,
                message: "You do not have admin privileges to this endpoint."
            })
            return
        }

        let withdrawalUpdates = req.body.withdrawalUpdates || null;

        if (!withdrawalUpdates) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }
        
        try{

            for(let status in withdrawalUpdates){

                let dbStatus = 'ERROR';
                
                switch(status){
                    case 'APPROVED':
                            dbStatus = 'OPEN';
                    break;
                    case 'REJECTED':
                            dbStatus = 'REJECTED';
                    break;
                }

                await SQL.withdrawals.update({
                    status: dbStatus
                }, {
                    where: {
                        withdrawalId: withdrawalUpdates[status]
                    }
                });
            }

            res.status(200).json({
                success: true,
                message: 'Successfully updated withdrawal status'
            });
            
            return;
    
        }catch(e){
            console.log(e);
            res.status(500).json({
                success: false,
                message: "Something went wrong please try again later."
            })
        }

    }, //end of updateWithdrawalStatus

    getKycFiles: async function(req, res) {
        
        //*****We will always need to verify and get user details thru this for ALL private endpoints****
        const user = await dashboard.getUser(req)
        if (user == undefined) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        if (!user.isAdmin) {
            res.status(400).json({
                success: false,
                message: "You do not have admin privileges to this endpoint."
            })
            return
        }
        
        let merchantId = req.query.merchantId || null;
        
        if (!merchantId) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        let filePath = 'KYC/' + merchantId + '/';

        try{

            let results = await aws.getKeys(filePath);

            if(results.length == 0){
                res.status(400).json({
                    success: false,
                    message: "No files found"
                })
                return
            }

            let files = {};

            for(let path of results){
                
                let fileData = await aws.getFile(path);
                
                fileName = path.replace(filePath, '');

                files[fileName] = fileData;
            }

            // console.log(files);

            res.status(200).json({
                success: true,
                idNum: user.idNum,
                files: files
            });

            return;

        }catch(err){
            console.log(err);
            res.status(400).json({
                success: false,
                message: "Something went wrong please try again."
            })
            return
        }

    }, //end of getKycFiles

    updateMerchantInfo: async function(req, res) {
        
        //*****We will always need to verify and get user details thru this for ALL private endpoints****
        const user = await dashboard.getUser(req)
        if (user == undefined) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        if (!user.isAdmin) {
            res.status(400).json({
                success: false,
                message: "You do not have admin privileges to this endpoint."
            })
            return
        }
        
        let merchantId = req.body.merchantId || null;

        let allowedUpdateCols = ['kycStatus'];
        
        if (!merchantId) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        let updateData = {};

        for(let colName of allowedUpdateCols){
            
            if (!req.body[colName]) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            updateData[colName] = req.body[colName];
        }
        
        try{

            let user = await SQL.users.findOne({
                where: {
                    merchantId: merchantId
                }
            });
            
            if(user == null){
                res.status(400).json({
                    success: false,
                    message: "No user found"
                })
                return
            }

            await user.update({updateData});

            res.status(200).json({
                success: true,
                message: "Successfully updated merchant info."
            });

            return;

        }catch(err){
            console.log(err);
            res.status(400).json({
                success: false,
                message: "Something went wrong please try again."
            })
            return
        }

    }, //end of updateMerchantInfo


    updateKycStatus: async function(req, res) {
        
        //*****We will always need to verify and get user details thru this for ALL private endpoints****
        const user = await dashboard.getUser(req)
        if (user == undefined) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        if (!user.isAdmin) {
            res.status(400).json({
                success: false,
                message: "You do not have admin privileges to this endpoint."
            })
            return
        }
        
        let merchantId = req.body.merchantId || null;
        let kycStatus = req.body.kycStatus || null;
        
        if (!merchantId || !kycStatus ) {
            res.status(400).json({
                success: false,
                message: "Incorrect or missing parameters, please refer to API doc."
            })
            return
        }

        try{

            let updateUser = await SQL.users.findOne({
                where: {
                    merchantId: merchantId
                }
            });
            
            if(updateUser == null){
                res.status(400).json({
                    success: false,
                    message: "No user found"
                })
                return
            }

            if(updateUser.kycStatus != "PENDING"){
                res.status(400).json({
                    success: false,
                    message: "Current Action Not Allowed"
                })
                return
            }

            await updateUser.update({ kycStatus : kycStatus });

            res.status(200).json({
                success: true,
                message: "Successfully updated KYC status."
            });

            return;

        }catch(err){
            console.log(err);
            res.status(400).json({
                success: false,
                message: "Something went wrong please try again."
            })
            return
        }

    }, //end of updateKycStatus

} //end of module.exports