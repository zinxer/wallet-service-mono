const requestpn = require("request-promise-native")
const createHmac = require("create-hmac")

const lib = require("../lib.js")

const MYMERCHANTID = process.env.IPN_TEST_MERCHANT_ID //your <Merchant ID> from the dashboard.
const APIKEY = process.env.IPN_TEST_API_KEY //your API key from the dashboard.
const SECRET = process.env.IPN_TEST_API_SECRET //your API secret from the dashboard.
const CMD = "_notify-validate" //required by Payment Gateway
const VALIDATE_IPN_URL = lib.CONFIG.DOMAIN + "/v1/ipn/validate" //Please get latest doc for updated validation url.


function doSomething() {
    //Data retrieved from IPN is valid!
    //Check merchantId to yours
    //Process your payment based on payment address!
    return
}


module.exports = {

        retrieveVerifyDataIPN: async function(req, res) {
        	//console.log("-D-", req.body)
            //Assign received results
            orderId = req.body.orderId || null
            merchantId = req.body.merchantId || null
            paymentAddr = req.body.paymentAddr || null
            transactionAmt = req.body.transactionAmt || null
            currentReceived = req.body.currentReceived || null
            totalReceived = req.body.totalReceived || null
            // isConfirmed = req.body.isConfirmed || null

            if ((orderId == null) || (merchantId == null) || (paymentAddr == null) || (transactionAmt == null) || (currentReceived == null) || (totalReceived == null) ) {
                //Incorrect IPN data received since there are missing key-value, could be from unknown source, IGNORE.
                return
            }

            //construct the post request body
            var requestBody = {
                orderId: orderId,
                merchantId: merchantId,
                paymentAddr: paymentAddr,
                transactionAmt: transactionAmt,
                currentReceived: currentReceived,
                totalReceived: totalReceived,
                cmd: CMD
            }

            //get the hmac required for header.
            var hmac = createHmac('sha512', Buffer.from(SECRET)).update(JSON.stringify(requestBody)).digest("hex")
            //construct the post request header
            var requestHeader = {
            	apikey: APIKEY,
            	hmac: hmac
            }

            requestpn({
                url: VALIDATE_IPN_URL,
                method: "POST",
                headers: requestHeader,
                form: requestBody
            }).then((resultIPN) => {
                if (resultIPN == 'VERIFIED') {
                    doSomething()
                    res.status(200).json({
                        success: true,
                        message: "Data is VERIFIED"
                    })
                    return
                } else {
                    res.status(400).json({
                        success: false,
                        message: "Data is INVALID"
                    })
                    return
                    //returned string is "INVALID"
                    //Someone must have sent wrong data to your ipn_listener! IGNORE
                }
            }).catch(e => {
                res.status(400).json({
                    success: false,
                    message: "Request is wrong. Error: " + e
                })
                return
            })
        }, //end of retrieveIPN

    } //end of module.exports