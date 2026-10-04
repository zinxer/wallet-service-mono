const lib = require('./lib/lib.js')
const router = require('express').Router()

const usdt_pg = require('./lib/usdt_pg-local.js')
const admin = require('./lib/admin.js')
const dashboard = require('./lib/dashboard.js')
const testIPN = require('./lib/tests/ipn_listener.js')

//TODO: Add verbosity switch for all console logs.
router.use(async function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    
    var apiKey = req.headers.apikey || null
    var hmac = req.headers.hmac || null
    var body = ""
    if (req.body) {
        body = req.body
    }
    
    // console.log(JSON.stringify(req.body))
    var skip = false
    var originalUrl = req.originalUrl
    var endpoint = req._parsedUrl.path
    var method = req.method
    var epoch = Math.floor(new Date())
    var ipAddr = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress; //Log ip address.


    // Check if there are suspicious characters in request payload
    if( !checkParams(req.body) || !checkParams(req.params) || !checkParams(req.query) || !checkParams(req.cookies) ){
        console.log("Suspicious Payload In Route: " + req.url);
        lib.bot.sendMonGrpMessage("*-WARNING- Suspicious Payload!*\n" + "Route: " + req.url);
        res.status(401).json({
            status: false,
            message: 'Suspicious Activity Detected'
        });
        return;
    }

    //Skip APIkey and Hmac check if is dashboard endpoints
    const skipHmacUrls = lib.CONFIG.ENDPOINTS.PUBLIC_URLS.concat(lib.CONFIG.ENDPOINTS.PRIVATE_URLS)
        //console.log(req.method)

    if ((req.method == 'GET') && (originalUrl.includes('?'))) {
        originalUrl = originalUrl.substring(0, originalUrl.indexOf('?'))
    }

    await skipHmacUrls.forEach((url, index) => {
        // console.log(originalUrl, url)
        if (url == originalUrl) {
            skip = true //Not merchant API, so skip.
            next()
        }
    })
    
    if (!skip) {
        
        //console.log("Received HMAC: ", hmac)
        if (!apiKey || !hmac) {
            res.status(401).json({
                message: 'Permission denied: apikey or HMAC not found in header.'
            })
            return
        }

        await lib.SQL.api_keys.findOne({
            where: {
                apiKey: apiKey
            }
        }).then( async (key) => {
            if (key == null) {
                res.status(401).json({
                    status: false,
                    message: 'Permission denied: Invalid API Key.'
                })
                return
            }

            var hmacGen = lib.createHmac('sha512', Buffer.from(key.secretKey)).update(JSON.stringify(body)).digest("hex")
                //console.log("Generated HMAC: ", hmacGen)
            
            if (key.isActive == false) {
                res.status(401).json({
                    status: false,
                    message: 'Permission denied: API Key no longer active.'
                })
                return
            } else if (hmacGen != hmac) {
                //hmac does not matches SHA512(req.body)
                res.status(401).json({
                    status: false,
                    message: 'Permission denied: Invalid HMAC.'
                })
                return
            } else {
                try{
                    let arrWhitelistedIps = await lib.SQL.whitelisted_ips.findAll({
                        where: {
                            wip_apiKey: apiKey
                        }
                    })

                    // No Whitelisted IP set. Allow Request
                    if(arrWhitelistedIps.length == 0){
                        next();
                        return;
                    }
                    
                    let epoch = Math.round((new Date()).getTime() / 1000);

                    for(let whitelistData of arrWhitelistedIps){
                        if(whitelistData.wip_ip == ipAddr){
                            whitelistData.update({wip_lastAccess: epoch})
                            next();
                            return;
                        }
                    }

                    console.log('Attempted API Key use from unauthorised IP');
                    res.status(401).json({
                        status: false,
                        message: 'Permission denied'
                    });
                    return;

                }catch(err){
                    console.log('-E- Whitelisted IP DB error ', err)
                    res.status(401).json({
                        status: false,
                        message: 'Permission denied'
                    })
                    return
                }
            }
        }).catch((err) => {
            console.log('-E- apikey DB error ', err)
            res.status(401).json({
                message: 'Permission denied: ',
                err
            })
            return
        })
    } //end of skip check

    //Log api queries into tmp area.
    lib.fs.appendFile(lib.CONFIG.APILOGPATH, epoch + ' ' + apiKey + ' [' + method + '] ' + ipAddr + ' ' + endpoint + '\n', function(err) {
        if (err) throw err;
        //console.log('-I- Saved query to: ' + API_LOG_FILE);
    });
});

//Combines public urls and merchant only urls
const publicEndpoints = lib.CONFIG.ENDPOINTS.PUBLIC_URLS.concat(lib.CONFIG.ENDPOINTS.MERCHANT_URLS)

router.use(lib.expressJWT({
    secret: lib.CONFIG.ENDPOINTS.SECRET
}).unless({
    //For merchant API Request or web dashboard E.g. Login/Signup APIs
    path: publicEndpoints
}));

router.use(function(err, req, res, next) {
    
    if (err) {
        res.status(401).send({
            status: false,
            message: "JWT token expired or no authorisation token was found. Error: 338"
        })
        //console.log("-W- [338] " + err)
    } else {
        next();
    }
});

// Run Functions before processing API
router.use(async function(req, res, next) {

    let kycUrls = lib.CONFIG.ENDPOINTS.KYC_PATHS;

    if(kycUrls.includes(req.path)){

        if(req.user != undefined){
            
            let user = await lib.SQL.users.findOne({
                where: {
                    id: req.user.id,
                    isActive: true
                }
            })
    
            if(user.kycStatus != 'APPROVED'){
                res.status(401).send({
                    status: false,
                    message: "User verification has not been completed or user is inactive"
                });
            }else{
                next();
            }
            return;
        }
        
    }else{
        next();
    }
    
});

const createAccountLimiter = lib.rateLimit({
    windowMs: 1 * 60 * 1000, // 1 mins window
    max: 10, // start blocking after 5 requests
    message: {
        status: false,
        message: "Rate limit reached, do not abuse the service. Please try again in 5 minutes."
    }
});

const isValidJSONString = (str) => {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

const checkParams = (param) => {

    // Whitelisted Characters Allowed in Params
    let regex = /^[A-Za-z0-9 \/,@&_:.%$#*=-]*$/;

    for(let index in param){

        let val = param[index];

        if(isValidJSONString(val)){
            val = JSON.parse(val);
        }
        
        if(val && typeof val === 'object' && val.constructor === Object){
            if(!checkParams(val)){
                return false;
            }
        }else if(!regex.test(val)){
            console.log("Param Value Rejected: " + val);
            lib.bot.sendMonGrpMessage("*-WARNING- Parameter Value Rejected!*\n" + "Params: " + JSON.stringify(param) + "\n" + "Rejected Value: " + val);
            return false;
        }
        
    }

    return true;
};

// MERCHANT ROUTES
// =================================================
router.route('/transaction/create').post(function(req, res) {
    usdt_pg.createTx(req, res);
});

router.route('/transaction/info').post(function(req, res) {
    usdt_pg.getTxInfo(req, res);
});

router.route('/transaction/pending').post(createAccountLimiter, function(req, res) {
    usdt_pg.getPendingTx(req, res);
});

router.route('/ipn/validate').post(function(req, res) {
    usdt_pg.validateIPN(req, res);
});

// Temporary to allow merchants to transition to new API
router.route('/networkfee').get(function(req, res) {
    usdt_pg.getEstimatedFee(req, res);
});

router.route('/networkfee').post(function(req, res) {
    usdt_pg.getEstimatedFee(req, res);
});

router.route('/transaction/bulkWithdraw').post(createAccountLimiter, function(req, res) {
    usdt_pg.autoBulkWithdraw(req, res);
});

router.route('/info').get(function(req, res) {
    usdt_pg.getMerchantInfo(req, res);
});

//TEST ROUTES
// =================================================
router.route('/test/ipn_listener').post(function(req, res) {
    testIPN.retrieveVerifyDataIPN(req, res);
});

//ADMIN ROUTES
// =================================================

router.route('/admin/user').get(createAccountLimiter, function(req, res) {
    admin.getAllUsers(req, res);
});

router.route('/admin/user').post(createAccountLimiter, function(req, res) {
    admin.updateMerchantInfo(req, res);
});

router.route('/admin/user/register').post(createAccountLimiter, function(req, res) {
    admin.registerUser(req, res);
});

router.route('/admin/ipn/resend').post(createAccountLimiter, function(req, res) {
    admin.manualPostIpnAdmin(req, res);
});

router.route('/admin/withdraw/verify').get(createAccountLimiter, function(req, res) {
    admin.getWithdrawalsToVerify(req, res);
});

router.route('/admin/withdraw/verify').post(createAccountLimiter, function(req, res) {
    admin.updateWithdrawalStatus(req, res);
});

router.route('/admin/withdraw/total').get(createAccountLimiter, function(req, res) {
    admin.getTotalWithdrawableAmt(req, res);
});

router.route('/admin/kyc').get(createAccountLimiter, function(req, res) {
    admin.getKycFiles(req, res);
});

router.route('/admin/kyc').post(createAccountLimiter, function(req, res) {
    admin.updateKycStatus(req, res);
});

//DASHBOARD ROUTES
// =================================================

router.route('/merchant/register').post(createAccountLimiter, function(req, res) {
    dashboard.registerUser(req, res);
});

router.route('/merchant/login').post(createAccountLimiter, function(req, res) {
    dashboard.loginUser(req, res);
});

router.route('/merchant/login/forgot').post(createAccountLimiter, function(req, res) {
    dashboard.forgotPassword(req, res);
});

router.route('/merchant/reset/info').get(createAccountLimiter, function(req, res) {
    dashboard.getResetInfo(req, res);
});

router.route('/merchant/password').post(createAccountLimiter, function(req, res) {
    dashboard.changePassword(req, res);
});

router.route('/merchant/reset/password').post(createAccountLimiter, function(req, res) {
    dashboard.resetNewPassword(req, res);
});

router.route('/merchant/verify').get(function(req, res) {
    dashboard.verifyUser(req, res);
});

router.route('/merchant/info').get(function(req, res) {
    dashboard.getUserInfo(req, res);
});

router.route('/merchant/info').post(function(req, res) {
    dashboard.updateUserInfo(req, res);
});

router.route('/merchant/orders').get(function(req, res) {
    dashboard.getOrders(req, res);
});

router.route('/merchant/withdraw/check').post(function(req, res) {
    dashboard.preCheckWithdraw(req, res);
});

router.route('/merchant/withdraw').get(function(req, res) {
    dashboard.getWithdrawals(req, res);
});

router.route('/merchant/withdraw').post(function(req, res) {
    dashboard.withdrawUSDT(req, res);
});

router.route('/merchant/withdraw/bulk/check').post(function(req, res) {
    dashboard.preBulkWithdrawUSDT(req, res);
});

router.route('/merchant/withdraw/bulk').post(function(req, res) {
    dashboard.bulkWithdrawUSDT(req, res);
});

router.route('/merchant/2fa/email/send').post(createAccountLimiter, function(req, res) {
    dashboard.send2FA(req, res);
});

router.route('/merchant/verification').post(function(req, res) {
    dashboard.sendVerification(req, res);
});

router.route('/merchant/api').post(function(req, res) {
    dashboard.genAPIKeys(req, res);
});

router.route('/merchant/api/status').post(function(req, res) {
    dashboard.setAPIKeyStatus(req, res);
});

router.route('/merchant/ipn').post(function(req, res) {
    dashboard.setIPN(req, res);
});

router.route('/merchant/ipn/handle').get(function(req, res) {
    dashboard.toggleIPNHandle(req, res);
});

router.route('/merchant/ipn/history').get(function(req, res) {
    dashboard.getIpnHistory(req, res);
});

router.route('/merchant/ipn/resend').post(function(req, res) {
    dashboard.manualPostIpnMerchant(req, res);
});

router.route('/merchant/ipn/sample').post(createAccountLimiter, function(req, res) {
    dashboard.sendSampleIPN(req, res);
});

router.route('/merchant/transaction/toggle').get(function(req, res) {
    dashboard.toggleForcePush(req, res);
});

router.route('/merchant/deposits/').get(function(req, res) {
    dashboard.getDeposits(req, res);
});

router.route('/merchant/deposits/gen').post(function(req, res) {
    dashboard.genDepositAddr(req, res);
});

router.route('/merchant/deposits/address').get(function(req, res) {
    dashboard.getDepositAddrs(req, res);
});

router.route('/merchant/2fa/otp/gen').get(function(req, res) {
    dashboard.genOtpSecret(req, res);
});

router.route('/merchant/2fa/otp/setup').post(function(req, res) {
    dashboard.setup2fa(req, res, 'FIRST');
});

router.route('/merchant/2fa/otp/delete').post(function(req, res) {
    dashboard.setup2fa(req, res, 'DELETE');
});

router.route('/merchant/chart/orders').post(function(req, res) {
    dashboard.getOrderChartData(req, res);
});

router.route('/merchant/tokens').get(function(req, res) {
    dashboard.getSupportedTokens(req, res);
});

router.route('/merchant/kyc').post(function(req, res) {
    dashboard.kycUpload(req, res);
});

router.route('/merchant/whitelistips').get(function(req, res) {
    dashboard.getWhitelistedIps(req, res);
});

router.route('/merchant/whitelistips').post(function(req, res) {
    dashboard.createWhitelistIp(req, res);
});

//export the router
module.exports = router;