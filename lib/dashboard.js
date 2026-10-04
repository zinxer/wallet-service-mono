//TODO: Allow only single login session at a time
//TODO: Need to release session when expire or logout (API to be created)
//TODO: Include "Send Fee" in fetchOrders, so that merchants know total cost for each order's send fee.
//TODO: Get Merchant Info to return all merchant's PG and Withdrawals specs for frontend calculation.

const lib = require('./lib.js')
const log = require("./console_log.js")
const utility = require("./utility.js")
const aws = require("./aws.js")
const SQL = lib.SQL

//auto release isWithdrawing status of all users whenever app restarts.
resetWithdrawStatus()

//numbers with commas
function nbr(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function delay(t, val) {
    return new Promise(function(resolve) {
        setTimeout(function() {
            resolve(val);
        }, t);
    });
} //end of delay

//Clear withdrawStatus set by bulkWithdrawal during scheduling
async function resetWithdrawStatus() {
    log.info("Reset all user's isWithdrawing status.")
    await SQL.users.findAll({
        where: {
            isWithdrawing: true
        }
    }).then(async(users) => {
        await users.forEach(user => {
            user.update({
                isWithdrawing: false
            })
        })
    }).catch(e => {
        log.error(e)
        return false
    })
    return
} //end of resetWithdrawStatus

async function ipn_post(transaction, receivedAmt, totalReceived = null) {

    if (!transaction.orderId || !transaction.merchantId || !transaction.paymentAddr || !receivedAmt) {
        // console.log("-E- txid param not valid.")
        return {
            error: "Please make sure that appropriate arguments are specified."
        }
    }

    var result = false;

    await SQL.usdt_tx_batches
        .findOne({
            where: {
                orderId: transaction.orderId,
                merchantId: transaction.merchantId,
                paymentAddr: transaction.paymentAddr
            }
        })
        .then(async txObj => {
            if (!txObj) {
                throw new Error("Unable to find specified transaction.");
            }

            await SQL.users
                .findOne({
                    where: {
                        merchantId: txObj.merchantId,
                        isActive: true
                    }
                })
                .then(async user => {
                    if (!user || user == undefined) {
                        console.log(
                            "-W- Merchant " + txObj.merchantId + " does not exist or is no longer active."
                        )
                        throw new Error("-I- Merchant " +
                            txObj.merchantId +
                            " does not exist or is no longer active.");
                    }

                    if (user.ipn_url == null) {
                        console.log(
                            "-W- Merchant " + txObj.merchantId + " had not set an IPN callback URL."
                        )
                        return;
                    }


                    var ipn_url = user.ipn_url
                        //POST to merchant's IPN
                    var headers = {
                        "Content-Type": "application/x-www-form-urlencoded"
                    }

                    let nodeToken = txObj.node + '_' + txObj.token;

                    if (totalReceived == null) {

                        let params = {
                            coinType: nodeToken,
                            address: txObj.paymentAddr
                        }
                        totalReceived = await lib.walletObj.computeAddressReceivedSQL(params);
                    }

                    //==============Check for IPN Handler==================
                    //Only send one IPN if IPN Handle is TRUE
                    var didSendFullPaymentIPNBefore = false
                    if ((totalReceived - receivedAmt) >= txObj.amount) {
                        didSendFullPaymentIPNBefore = true
                    }

                    if (user.ipn_handle && (totalReceived < txObj.amount)) {
                        //Don't send IPN
                        return true
                    }

                    if (user.ipn_handle && (totalReceived >= txObj.amount)) {
                        if (didSendFullPaymentIPNBefore) {
                            //Full payment IPN had been sent prior. Do not send any IPN for this payment addr anymore.
                            return true
                        }
                    }
                    //====================================================

                    var body = {
                        orderId: txObj.orderId,
                        merchantId: txObj.merchantId,
                        paymentAddr: txObj.paymentAddr,
                        transactionAmt: parseFloat(txObj.amount).toFixed(8),
                        currentReceived: parseFloat(receivedAmt).toFixed(8),
                        totalReceived: parseFloat(totalReceived).toFixed(8)
                    }

                    let bodyString = JSON.stringify(body);

                    await txObj
                        .update({
                            ipn_status: "SENT" //SENT, VERIFIED, INVALID
                        })
                        .catch(err => {
                            log.error('E101:' + err)
                            throw err;
                        }) //end of catch

                    await SQL.db.query(`
                        UPDATE ipn_history 
                        set ipn_times_sent = ipn_times_sent + 1, ipn_req_body = ?, ipn_status = 'SENT', ipn_lastSent_epoch = unix_timestamp()
                        where ipn_merchantId = ? 
                        and ipn_orderId = ? 
                        and ipn_paymentAddr = ?
                        and ipn_currentReceived = ?
                        and ipn_totalReceived = ?`, {
                        replacements: [bodyString, txObj.merchantId, txObj.orderId, txObj.paymentAddr, receivedAmt, totalReceived],
                        type: SQL.db.QueryTypes.UPDATE
                    }).catch(function(err) {
                        log.error('E103:' + err)
                        throw err;
                    });

                    await lib.requestpn({
                        url: `${ipn_url}`,
                        method: "POST",
                        headers: headers,
                        form: body,
                        timeout: 30000
                    }).then(async response => {

                        result = true;

                        let responseString = JSON.stringify(response);

                        await SQL.db.query(`
                            UPDATE ipn_history 
                            set ipn_res_body = ?, ipn_status = 'RECEIVED'
                            where ipn_merchantId = ? 
                            and ipn_orderId = ? 
                            and ipn_paymentAddr = ?
                            and ipn_currentReceived = ?
                            and ipn_totalReceived = ?`, {
                            replacements: [responseString, txObj.merchantId, txObj.orderId, txObj.paymentAddr, receivedAmt, totalReceived],
                            type: SQL.db.QueryTypes.UPDATE
                        }).catch(function(err) {
                            log.error('E103:' + err)
                            throw err;
                        });

                    }).catch(async err => {

                        log.error("E102: " + err)

                        let responseString = JSON.stringify(err);

                        await SQL.db.query(`
                            UPDATE ipn_history 
                            set ipn_times_sent = ipn_times_sent + 1, ipn_req_body = ?, ipn_res_body = ?, ipn_status = 'SENT', ipn_lastSent_epoch = unix_timestamp()
                            where ipn_merchantId = ? 
                            and ipn_orderId = ? 
                            and ipn_paymentAddr = ?
                            and ipn_currentReceived = ?
                            and ipn_totalReceived = ?`, {
                            replacements: [bodyString, responseString, txObj.merchantId, txObj.orderId, txObj.paymentAddr, receivedAmt, totalReceived],
                            type: SQL.db.QueryTypes.UPDATE
                        }).catch(function(err2) {
                            log.error('E103:' + err2)
                            throw err2;
                        });

                    });

                })
                .catch(err => {
                    log.error('E104:' + err)
                    throw err;
                }) //end of catch
        }) //end of .then txObj
        .catch(err => {
            log.error('E105:' + err)
            throw err;
        }) //end of catch
    return result;
} //end of ipn_post

const sendVeriLink = async(userObj) => {
        const vericode = lib.randomize('Aa0', 48) + '-' + userObj.email
        var veriLink = lib.CONFIG.DOMAIN + lib.CONFIG.PREFIX + '/merchant/verify?v=' + vericode
            // For -DEV- purposes, uncomment below line.
            //var veriLink = lib.CONFIG.DOMAIN + '/dev' + '/merchant/verify?v=' + vericode
        let transporter = lib.nodemailer.createTransport({
            host: lib.CONFIG.EMAIL_VERILINK.HOST,
            port: lib.CONFIG.EMAIL_VERILINK.PORT,
            secure: true, // upgrade later with STARTTLS
            auth: {
                user: lib.CONFIG.EMAIL_VERILINK.ADDRESS,
                pass: lib.CONFIG.EMAIL_VERILINK.PASSWORD
            },
            tls: {
                rejectUnauthorized: false
            }
        })

        lib.juice.juiceFile(__dirname + '/../templates/email_verification.html', null, async(err, html) => {
            if (err) {
                console.log(err);
            } else {

                html = html.replace('emailverilink_placeholder', veriLink);

                //set mail options
                let mailOptions = {
                    from: lib.CONFIG.EMAIL_VERILINK.FROM,
                    to: userObj.email,
                    subject: lib.CONFIG.EMAIL_VERILINK.SUBJECT,
                    html: html,
                    }

                await transporter.sendMail(mailOptions, async function(error, info) {
                        if (error) {
                            console.log("-E- ", error)
                            return {
                                "error": "Failed to send email, please try again later."
                            }
                        }
                    }) //end of await transporter.sendMail

                //Update Database with latest verification code.
                await userObj.update({
                        vericode: vericode,
                        vericodeEpoch: Math.floor(new Date() / 1000)
                    }).catch((e) => {
                        log.error(e)
                        return {
                            "error": e
                        }
                    }) //end of catch
                return true
            }

            // //set mail options
            // let mailOptions = {
            //     from: lib.CONFIG.EMAIL_VERILINK.FROM,
            //     to: userObj.email,
            //     subject: lib.CONFIG.EMAIL_VERILINK.SUBJECT,
            //     text: 'Please verify your email address by clicking on the following link: ' + veriLink
            // }

            // await transporter.sendMail(mailOptions, async function(error, info) {
            //     if (error) {
            //         console.log("-E- ", error)
            //         return {
            //             "error": "Failed to send email, please try again later."
            //         }
            //     }

            //     //Update Database with latest verification code.
            //     await userObj.update({
            //             vericode: vericode,
            //             vericodeEpoch: Math.floor(new Date() / 1000)
            //         }).catch((e) => {
            //             log.error(e)
            //             return {
            //                 "error": e
            //             }
            //         }) //end of catch
            //     return true
            // }) //end of await transporter.sendMail

        });
    } //end of sendVeriLink

const emailResetPass = async(userObj) => {
        const vericode = lib.randomize('Aa0', 48)
        var veriLink = lib.CONFIG.MAIN + lib.CONFIG.STATUS_DIR + 'password?hash=' + vericode

        await lib.nodemailer.createTestAccount(async(err, account) => {
            // let transporter = lib.nodemailer.createTransport({
            //     host: lib.CONFIG.EMAIL_PASSRESET.HOST,
            //     port: lib.CONFIG.EMAIL_PASSRESET.PORT,
            //     secure: true, // upgrade later with STARTTLS
            //     auth: {
            //         user: lib.CONFIG.EMAIL_PASSRESET.ADDRESS,
            //         pass: lib.CONFIG.EMAIL_PASSRESET.PASSWORD
            //     },
            //     tls: {
            //         rejectUnauthorized: false
            //     }
            // })

            let transporter = lib.nodemailer.createTransport({
                host: lib.CONFIG.EMAIL_VERILINK.HOST,
                port: lib.CONFIG.EMAIL_VERILINK.PORT,
                secure: true, // upgrade later with STARTTLS
                auth: {
                    user: lib.CONFIG.EMAIL_VERILINK.ADDRESS,
                    pass: lib.CONFIG.EMAIL_VERILINK.PASSWORD
                },
                tls: {
                    rejectUnauthorized: false
                }
            })

            if (err) {
                console.log("-E- Something went wrong with emailResetPass, please try again later.")
                return {
                    "error": "Something went wrong with emailResetPass, please try again later."
                }
            }

            lib.juice.juiceFile(__dirname + '/../templates/reset_password.html', null, async(err, html) => {
                if (err) {
                    console.log(err);
                } else {

                    html = html.replace('passresetlink_placeholder', veriLink);

                    //set mail options
                    let mailOptions = {
                        from: lib.CONFIG.EMAIL_PASSRESET.FROM,
                        to: userObj.email,
                        subject: lib.CONFIG.EMAIL_PASSRESET.SUBJECT,
                        html: html,
                        }

                    await transporter.sendMail(mailOptions, async function(error, info) {
                            if (error) {
                                console.log("-E- ", error)
                                return {
                                    "error": "Failed to send email, please try again later."
                                }
                            }
                        }) //end of await transporter.sendMail

                    //Update Database with latest verification code.
                    await userObj.update({
                            vericode: vericode,
                            vericodeEpoch: Math.floor(new Date() / 1000)
                        }).catch((e) => {
                            log.error(e)
                            return {
                                "error": e
                            }
                        }) //end of catch
                    return true

                }
            });

            // //set mail options
            // let mailOptions = {
            //     from: lib.CONFIG.EMAIL_PASSRESET.FROM,
            //     to: userObj.email,
            //     subject: lib.CONFIG.EMAIL_PASSRESET.SUBJECT,
            //     text: 'Please reset your password by clicking the following link within the next 10 minute: ' + veriLink
            // }

            // await transporter.sendMail(mailOptions, async function(error, info) {
            //     if (error) {
            //         console.log("-E- ", error)
            //         return {
            //             "error": "Failed to send email, please try again later."
            //         }
            //     }
            //     await userObj.update({
            //             vericode: vericode,
            //             vericodeEpoch: Math.floor(new Date() / 1000)
            //         }).catch((e) => {
            //             log.error(e)
            //             return {
            //                 "error": e
            //             }
            //         }) //end of catch
            //         //Update Database with latest verification code.
            //     return true
            // }) //end of await transporter.sendMail

        })
    } //end of emailResetPass

const email2FA = async(userObj) => {
        const num2fa = lib.randomize('0', 6);

        let transporter = lib.nodemailer.createTransport({
            host: lib.CONFIG.EMAIL_2FA.HOST,
            port: lib.CONFIG.EMAIL_2FA.PORT,
            secure: true, // upgrade later with STARTTLS
            auth: {
                user: lib.CONFIG.EMAIL_2FA.ADDRESS,
                pass: lib.CONFIG.EMAIL_2FA.PASSWORD
            },
            tls: {
                rejectUnauthorized: false
            }
        })

        /*
                        if (err) {
                            console.log("-E- Something went wrong with email2FA, please try again later.")
                            console.log(err)
                            return {
                                "error": "Something went wrong with email2FA, please try again later."
                            }
                        }
                        */

        lib.juice.juiceFile(__dirname + '/../templates/OTP_email.html', null, async(err, html) => {
            if (err) {
                console.log(err);
            } else {

                html = html.replace('emailotp_placeholder', num2fa);

                //set mail options
                let mailOptions = {
                    from: lib.CONFIG.EMAIL_2FA.FROM,
                    to: userObj.email,
                    subject: lib.CONFIG.EMAIL_2FA.SUBJECT,
                    html: html,
                    }

                await transporter.sendMail(mailOptions, async function(error, info) {
                        if (error) {
                            console.log("-E- ", error)
                            return {
                                "error": "Failed to send email, please try again later."
                            }
                        }
                    }) //end of await transporter.sendMail

                //Update Database with latest verification code.
                await userObj.update({
                        code2fa: num2fa,
                        code2faEpoch: Math.floor(new Date() / 1000)
                    }).catch((e) => {
                        log.error(e)
                        return {
                            "error": e
                        }
                    }) //end of catch
                return true

            }
        });

        // //set mail options
        // let mailOptions = {
        //     from: lib.CONFIG.EMAIL_2FA.FROM,
        //     to: userObj.email,
        //     subject: lib.CONFIG.EMAIL_2FA.SUBJECT,
        //     text: 'Your Merchant 2FA code is: ' + num2fa
        // }

        // await transporter.sendMail(mailOptions, async function(error, info) {
        //     if (error) {
        //         console.log("-E- ", error)
        //         return {
        //             "error": "Failed to send email, please try again later."
        //         }
        //     }

        //     //Update Database with latest 2FA code.
        //     await userObj.update({
        //             code2fa: num2fa,
        //             code2faEpoch: Math.floor(new Date() / 1000)
        //         }).catch((e) => {
        //             log.error(e)
        //             return {
        //                 "error": e
        //             }
        //         }) //end of catch
        //     return true
        // }) //end of await transporter.sendMail

    } //end of email2FA

const getUserObj = async(email) => {

        var userObj = null
        await SQL.users.findOne({
            where: {
                email: email,
                isActive: true
            }
        }).then((user) => {
            userObj = user
        }).catch((e) => {
            return {
                error: e
            }
        })
        return userObj
    } //end of getUserObj

const fetchForwarded = async(merchantId) => {
        var retObj = {} //declare

        let userData = await SQL.users.findOne({
            where: {
                merchantId: merchantId
            }
        });

        //1. Get total Forwarded USDT
        await SQL.db.query(`
            select 
                st_node,
                st_token,
                sum(ifnull(amount, 0)) as totalReceived,
                sum( ifnull(amount, 0) * ifnull(fee, 0) ) as totalPgFee,
                sum( ifnull(amount, 0) * ifnull(resellerFee, 0) ) as totalResellerFees,
                sum(ifnull(sendFeeUsd, 0)) as totalSendingFee                
            from supportedtokens
            left join usdt_clear_batches on 
                node = st_node 
                and token = st_token 
                and merchantId = ?
                and status not in ('INVALID', 'OPEN')
                and sendFeeUsd is not null
            group by st_node, st_token`, {
            replacements: [merchantId],
            type: SQL.db.QueryTypes.SELECT
        }).then(async(results) => {
            for (let rowObj of results) {

                if (retObj[rowObj.st_node] == undefined) {
                    retObj[rowObj.st_node] = {};
                }

                retObj[rowObj.st_node][rowObj.st_token] = {
                    totalOrdersAmt: rowObj.totalReceived,
                    totalOrderFees: rowObj.totalPgFee,
                    totalResellerFees: rowObj.totalResellerFees,
                    totalSendFees: rowObj.totalSendingFee,
                    ordersFee: userData.fee
                };
            }
        }).catch((e) => {
            console.log(e);
            return {
                error: e
            }
        });

        //console.log(retObj)
        return retObj
    } //end of fetchForwarded

const fetchWithdrawed = async(merchantId) => {
        var retObj = {} //declare

        await SQL.db.query(`
            select 
                st_node,
                st_token,
                sum( ifnull(amount, 0) ) as totalWithdraw, 
                sum( ifnull(amount, 0) * ifnull(fee, 0) ) as totalWithdrawFee,
                sum( ifnull(amount, 0) * ifnull(resellerFee, 0) ) as totalResellerFees,
                sum( ifnull(chargedSendFeeUsd, 0) ) as totalChargedSendFees
            from supportedtokens
            left join withdrawals on 
                node = st_node 
                and token = st_token 
                and merchantId = ?
                and status not in ('INVALID')
            group by st_node, st_token`, {
            replacements: [merchantId],
            type: SQL.db.QueryTypes.SELECT
        }).then(async(results) => {

            try {

                let userData = await SQL.users.findOne({
                    where: {
                        merchantId: merchantId
                    }
                });

                for (let rowObj of results) {

                    if (retObj[rowObj.st_node] == undefined) {
                        retObj[rowObj.st_node] = {};
                    }

                    retObj[rowObj.st_node][rowObj.st_token] = {
                        totalWithdrawAmt: rowObj.totalWithdraw,
                        totalWithdrawFees: rowObj.totalWithdrawFee,
                        totalResellerFees: rowObj.totalResellerFees,
                        totalSendFees: rowObj.totalChargedSendFees,
                        withdrawFee: userData.withdraw_fee
                    };
                }
            } catch (err) {
                console.log(err);
                throw err;
            }

        }).catch((e) => {
            console.log(e);
            return {
                error: e
            }
        });

        return retObj
    } //end of fetchWithdrawed

async function fetchDeposits(merchantId) {

    try {

        let userData = await SQL.users.findOne({
            where: {
                merchantId: merchantId
            }
        });

        //1. Get total Deposited USDT
        let results = await SQL.db.query(`
            select 
                st_node,
                st_token,
                sum( ifnull( ucd_amount, 0 ) ) as totalDepositAmt,
                sum( ifnull( ucd_amount, 0 ) * ifnull( ucd_depositFee, 0 ) ) as totalDepositFee,
                sum( ifnull( ucd_amount, 0 ) * ifnull( ucd_resellerFee, 0 ) ) as totalResellerFees,
                sum( ifnull( ucd_sendFeeUsd, 0 ) ) as totalSendingFee                
            from supportedtokens
            left join usdt_clear_deposits on 
                ucd_node = st_node 
                and ucd_token = st_token 
                and ucd_merchantId = :merchantId
                and ucd_status not in ('INVALID', 'OPEN')
                and ucd_sendFeeUsd is not null
            group by st_node, st_token`, {
            replacements: {
                merchantId: merchantId
            },
            type: SQL.db.QueryTypes.SELECT
        });

        let retObj = {} //declare

        for (let rowObj of results) {

            if (retObj[rowObj.st_node] == undefined) {
                retObj[rowObj.st_node] = {};
            }

            retObj[rowObj.st_node][rowObj.st_token] = {
                totalDepositAmt: rowObj.totalDepositAmt,
                totalDepositFees: rowObj.totalDepositFee,
                totalResellerFees: rowObj.totalResellerFees,
                totalSendFees: rowObj.totalSendingFee,
                depositFee: userData.fee
            };
        }

        return retObj

    } catch (err) {
        console.log(err);
        throw err;
    }

} //end of fetchDeposits

const fetchWithdrawBal = async(merchantId, roundUp = true) => {
        var retObj = {} //declare
        var withdrawBal = 0
        var balance = 0
        let totalResellerFees = 0;

        //check if merchant exist
        await SQL.users.findOne({
            where: {
                merchantId: merchantId
            }
        }).then(async user => {
            if (user == null) {
                retObj = {
                    error: merchantId + " merchant account does not exist."
                }
            } else {

                if (user.isReseller) {
                    retObj = await fetchResellerWithdrawable(user.merchantId);
                } else {

                    let supportedTokens = await SQL.supportedTokens.findAll();

                    var forwards = await fetchForwarded(merchantId)
                    var withdraws = await fetchWithdrawed(merchantId)
                    var deposits = await fetchDeposits(merchantId)

                    for (let data of supportedTokens) {

                        let nodeToken = data.st_node + '_' + data.st_token;

                        let forwarded = forwards[data.st_node][data.st_token];
                        let withdrawed = withdraws[data.st_node][data.st_token];
                        let deposited = deposits[data.st_node][data.st_token];

                        let markupFeeUsd = await markupEstimateFeeUsd(nodeToken);

                        balance = Number(forwarded.totalOrdersAmt) -
                            Number(forwarded.totalOrderFees) //total PG charged fees
                            -
                            Number(forwarded.totalSendFees) //total orders sending fee in USD
                            +
                            Number(deposited.totalDepositAmt) // total deposit amount
                            -
                            Number(deposited.totalDepositFees) //total deposit fees charged
                            -
                            Number(deposited.totalSendFees) //total deposit sending fee in uSD
                            -
                            Number(withdrawed.totalWithdrawAmt) //total USDT withdrawed
                            -
                            Number(withdrawed.totalWithdrawFees) //total withdraw fees charged
                            -
                            Number(withdrawed.totalSendFees) //total withdraw send fees in USD

                        //withdrawable USDT balance
                        // withdrawBal = (balance - markupFeeUsd) / ( 100 + ( withdrawed.fee * 100 ) ) * 100; //next withdraw fee (assuming this is the last withdraw)
                        withdrawBal = balance - (balance * Number(withdrawed.withdrawFee)) - Number(markupFeeUsd); //next withdraw fee (assuming this is the last withdraw)

                        totalResellerFees = Number(forwarded.totalResellerFees) + Number(withdrawed.totalResellerFees) + Number(deposited.totalResellerFees);

                        //Show 0 balance if withdrawBal is lower than 0 due to pre withdraw fee calculation.
                        if (withdrawBal < 0) {
                            withdrawBal = 0
                        }

                        if (balance < 0) {
                            balance = 0
                        }

                        if (retObj[data.st_node] == undefined) {
                            retObj[data.st_node] = {};
                        }

                        if (roundUp) {
                            retObj[data.st_node][data.st_token] = {
                                balance: Number(balance).toFixed(2),
                                withdrawableBal: Number(withdrawBal).toFixed(2),
                                estimatedTxFee: Number(markupFeeUsd).toFixed(2),
                                totalOrdersAmt: Number(forwarded.totalOrdersAmt).toFixed(2),
                                totalDepositAmt: Number(deposited.totalDepositAmt).toFixed(2),
                                totalWithdrawAmt: Number(withdrawed.totalWithdrawAmt).toFixed(2),
                                totalResellerFees: Number(totalResellerFees).toFixed(2),
                                totalOrderSendFees: Number(forwarded.totalSendFees).toFixed(2),
                                totalOrderFees: Number(forwarded.totalOrderFees).toFixed(2),
                                totalDepositSendFee: Number(deposited.totalSendFees).toFixed(2),
                                totalDepositFees: Number(deposited.totalDepositFees).toFixed(2),
                                totalWithdrawalFees: Number(withdrawed.totalWithdrawFees).toFixed(2),
                                totalWithdrawalSendFees: Number(withdrawed.totalSendFees).toFixed(2)
                            };
                        } else {
                            retObj[data.st_node][data.st_token] = {
                                balance: Number(balance),
                                withdrawableBal: Number(withdrawBal),
                                estimatedTxFee: Number(markupFeeUsd),
                                totalOrdersAmt: Number(forwarded.totalOrdersAmt),
                                totalDepositAmt: Number(deposited.totalDepositAmt),
                                totalWithdrawAmt: Number(withdrawed.totalWithdrawAmt),
                                totalResellerFees: Number(totalResellerFees),
                                totalOrderSendFees: Number(forwarded.totalSendFees),
                                totalOrderFees: Number(forwarded.totalOrderFees),
                                totalDepositSendFee: Number(deposited.totalSendFees),
                                totalDepositFees: Number(deposited.totalDepositFees),
                                totalWithdrawalFees: Number(withdrawed.totalWithdrawFees),
                                totalWithdrawalSendFees: Number(withdrawed.totalSendFees)
                            };
                        }
                    }

                }

            }
        })
        return retObj
    } //end of fetchWithdrawBal

const fetchResellerWithdrawable = async(resellerId, roundUp = true) => {

        try {

            let retObj = {} //declare

            let reseller = await SQL.users.findOne({
                where: {
                    merchantId: resellerId
                }
            });

            if (reseller == null) {
                retObj = {
                    error: resellerId + " Reseller account does not exist."
                }
                return retObj;
            }

            let supportedTokens = await SQL.supportedTokens.findAll();

            let resellerTotalCollected = await SQL.db.query(`
            select 
                ifnull( case when node = 'OMNI' then sum( amount * ifnull(resellerFee, 0) ) else 0 end, 0 ) OMNI,
                ifnull( case when node = 'ETH' then sum( amount * ifnull(resellerFee, 0) ) else 0 end, 0 ) ETH
            from users 
            left join withdrawals on users.merchantId = withdrawals.merchantId and status not in ('INVALID', 'OPEN')
            where parentReseller = :resellerId
        `, {
                replacements: {
                    resellerId: resellerId
                },
                type: SQL.db.QueryTypes.SELECT
            });

            resellerTotalCollected = resellerTotalCollected[0];

            let withdraws = await fetchWithdrawed(resellerId);

            for (let data of supportedTokens) {

                let nodeToken = data.st_node + '_' + data.st_token;

                let withdrawed = withdraws[data.st_node][data.st_token];

                let markupFeeUsd = await markupEstimateFeeUsd(nodeToken);

                balance = Number(resellerTotalCollected[data.st_node]) -
                    Number(withdrawed.totalWithdrawAmt) //total USDT withdrawed
                    -
                    Number(withdrawed.totalWithdrawFees) //total withdraw fees charged
                    -
                    Number(withdrawed.totalSendFees) //total withdraw send fees in USD

                //withdrawable USDT balance
                // withdrawBal = (balance - markupFeeUsd) / ( 100 + ( withdrawed.fee * 100 ) ) * 100; //next withdraw fee (assuming this is the last withdraw)
                withdrawBal = balance - (balance * Number(withdrawed.withdrawFee)) - Number(markupFeeUsd); //next withdraw fee (assuming this is the last withdraw)

                //Show 0 balance if withdrawBal is lower than 0 due to pre withdraw fee calculation.
                if (withdrawBal < 0) {
                    withdrawBal = 0
                }

                if (balance < 0) {
                    balance = 0
                }

                if (retObj[data.st_node] == undefined) {
                    retObj[data.st_node] = {};
                }

                if (roundUp) {
                    retObj[data.st_node][data.st_token] = {
                        balance: Number(balance).toFixed(2),
                        withdrawableBal: Number(withdrawBal).toFixed(2),
                        estimatedTxFee: Number(markupFeeUsd).toFixed(2),
                        totalWithdrawAmt: Number(withdrawed.totalWithdrawAmt).toFixed(2),
                        totalWithdrawalFees: Number(withdrawed.totalWithdrawFees).toFixed(2),
                        totalWithdrawalSendFees: Number(withdrawed.totalSendFees).toFixed(2)
                    };
                } else {
                    retObj[data.st_node][data.st_token] = {
                        balance: Number(balance),
                        withdrawableBal: Number(withdrawBal),
                        estimatedTxFee: Number(markupFeeUsd),
                        totalWithdrawAmt: Number(withdrawed.totalWithdrawAmt),
                        totalWithdrawalFees: Number(withdrawed.totalWithdrawFees),
                        totalWithdrawalSendFees: Number(withdrawed.totalSendFees)
                    };
                }
            }

            return retObj

        } catch (err) {
            console.log(err);
            throw err;
        }

    } //end of fetchWithdrawBal

const fetchUSDTWithdrawals = async(params) => {
        var totalAmount = 0
        var pendingWithdrawal = 0
        var withdrawTxs = []
        var count = 0
        var withdrawObj = {
            totalUSDT: totalAmount,
            totalPending: pendingWithdrawal,
            transactions: withdrawTxs
        }

        let merchantId = params.merchantId;
        let node = params.node || null;
        let token = params.token || null;

        let whereClause = {
            merchantId: merchantId,
            status: {
                [lib.Op.notIn]: ["INVALID"]
            }
        };

        if (node != null && token != null) {
            whereClause["node"] = node;
            whereClause["token"] = token;
        }

        await SQL.withdrawals.findAll({
                where: whereClause
            }).then(async(withdrawals) => {
                if (!withdrawals || (withdrawals.length < 1)) {
                    return withdrawObj
                }

                await withdrawals.forEach(async(tx, index) => {
                    if (tx.status == "PENDING") {
                        pendingWithdrawal += parseFloat(tx.amount)
                    } else {
                        totalAmount += parseFloat(tx.amount)
                    }
                    count++ //keep track of number of withdrawals PENDING and CONFIRMED
                    //Push to transactions
                    withdrawTxs.push({
                        withdrawalId: tx.withdrawalId,
                        status: tx.status,
                        confirmedEpoch: tx.confirmedEpoch,
                        createdEpoch: tx.createdEpoch,
                        node: tx.node,
                        token: tx.token,
                        type: tx.type,
                        amount: parseFloat(tx.amount).toFixed(2),
                        fee: tx.fee,
                        actualFee: parseFloat(tx.amount * tx.fee).toFixed(2),
                        chargedSendFee: tx.chargedSendFeeUsd,
                        recipient: tx.destinationAddr,
                        txid: tx.txid
                    })
                })
            }).catch((e) => {
                return {
                    error: e
                }
            })
            //prepare return obj
        withdrawObj = {
                count: count,
                totalUSDT: totalAmount,
                totalPending: pendingWithdrawal,
                transactions: withdrawTxs
            }
            //console.log(withdrawObj)
        return withdrawObj
    } //end of fetchUSDTWithdrawals

const fetchOrderCount = async(merchantId) => {

        try {
            var orderCount = 0;
            var confirmCount = 0;
            var pendingCount = 0;

            let results = await SQL.db.query(`
            select
                sum(case when status in ('PENDING', 'CONFIRMED', 'EXPIRED') then 1 else 0 end) as TOTAL,
                sum(case when status = 'CONFIRMED' then 1 else 0 end) as CONFIRMED,
                sum(case when status = 'PENDING' then 1 else 0 end) as PENDING
            from usdt_tx_batches 
            where merchantId = ?;
        `, {
                replacements: [merchantId],
                type: SQL.db.QueryTypes.SELECT
            });

            if (results != null) {

                results = results[0];

                orderCount = results.TOTAL;
                confirmCount = results.CONFIRMED;
                pendingCount = results.PENDING;
            }

            return {
                orderCount: orderCount,
                confirmCount: confirmCount,
                pendingCount: pendingCount
            }
        } catch (err) {
            console.log(err);
            throw new Error(err);
        }

    } //end of fetchOrderCount

async function getLatestOrders(merchantId, count = 5, offset = 0) {

    try {

        let orders = [];

        let results = await SQL.usdt_tx_batches.findAndCountAll({
            where: {
                merchantId: merchantId
            },
            limit: count,
            offset: offset,
            order: [
                ['id', 'DESC']
            ]
        });

        if (results.count > 0) {

            for (let orderData of results.rows) {

                let orderObj = {
                    orderId: orderData.orderId,
                    status: orderData.status,
                    node: orderData.node,
                    token: orderData.token,
                    amount: parseFloat(orderData.amount).toFixed(2),
                    address: orderData.paymentAddr,
                    created: orderData.createdEpoch,
                    confirmed: orderData.confirmedEpoch,
                    ipnStatus: orderData.ipn_status
                }

                orders.push(orderObj);
            }
        }

        return orders;

    } catch (err) {
        console.log(err);
        throw new Error(err);
    }

}

const fetchOrders = async(merchantId, params = null) => {

        var orders = []
        var orderObj = {}
        let arrOrder = [];

        let node = params.node || null;
        let token = params.token || null;

        let orderBy = (params !== null && params.hasOwnProperty("orderBy")) ? params.orderBy : null;
        let filter = (params !== null && params.hasOwnProperty("filter")) ? params.filter : null;

        let startDate = 0;
        let endDate = 999999999999;

        for (let attr in orderBy) {
            arrOrder.push([attr, orderBy[attr]]);
        }

        for (let attr in filter) {

            if (attr == 'createdEpoch') {
                if (filter[attr].hasOwnProperty("startDate") && filter[attr].hasOwnProperty("endDate")) {
                    startDate = filter[attr].startDate;
                    endDate = filter[attr].endDate;
                }
            }
        }

        const Op = require('sequelize').Op;

        let whereClause = {
            merchantId: merchantId,
            createdEpoch: {
                [Op.and]: {
                    [Op.gte]: startDate,
                    [Op.lte]: endDate
                }
            }
        }

        let tempWhereClause = '';

        orderBy = (orderBy == 'asc') ? 'asc' : 'desc';

        if (node != null && token != null) {
            whereClause['node'] = node;
            whereClause['token'] = token;
            tempWhereClause = `and usdt_tx_batches.node = '${node}' and usdt_tx_batches.token = '${token}'`
        }

        let results = await SQL.db.query(`
        select 
            usdt_tx_batches.orderId, usdt_tx_batches.status, usdt_tx_batches.node, 
            usdt_tx_batches.token, usdt_tx_batches.amount, usdt_tx_batches.paymentAddr, 
            usdt_tx_batches.createdEpoch, usdt_tx_batches.confirmedEpoch, usdt_tx_batches.ipn_status, 
            usdt_tx_batches.createdByApiKey, ifnull( count(usdt_clear_batches.id), 0 ) as totalPayments,
            sum( ifnull( usdt_clear_batches.amount, 0 ) )  as totalReceived, sum( ifnull( usdt_clear_batches.amount * fee, 0 ) ) as totalDepositFee, 
            sum( ifnull( usdt_clear_batches.sendFeeUsd, 0 ) ) as totalNetworkFeeUsd, sum( ifnull( usdt_clear_batches.sendFee, 0 ) ) as totalNetworkFee
        from usdt_tx_batches
        left join usdt_clear_batches on usdt_tx_batches.orderId = usdt_clear_batches.orderId
        where 
            usdt_tx_batches.merchantId = ? 
            and usdt_tx_batches.createdEpoch >= ? 
            and usdt_tx_batches.createdEpoch <= ?
            ${tempWhereClause}
        group by 
            usdt_tx_batches.orderId, usdt_tx_batches.status, usdt_tx_batches.node, 
            usdt_tx_batches.token, usdt_tx_batches.amount, usdt_tx_batches.paymentAddr, 
            usdt_tx_batches.createdEpoch, usdt_tx_batches.confirmedEpoch, usdt_tx_batches.ipn_status, 
            usdt_tx_batches.createdByApiKey
        order by usdt_tx_batches.createdEpoch ${orderBy}
        `, {
            replacements: [merchantId, startDate, endDate],
            type: SQL.db.QueryTypes.SELECT
        });

        if (!results || (results.length < 1)) {
            return results
        }

        for (let i = 0; i < results.length; i++) {

            orderObj = {
                orderId: results[i].orderId,
                status: results[i].status,
                node: results[i].node,
                token: results[i].token,
                amount: parseFloat(results[i].amount).toFixed(2),
                received: parseFloat(results[i].totalReceived).toFixed(2),
                address: results[i].paymentAddr,
                created: results[i].createdEpoch,
                confirmed: results[i].confirmedEpoch,
                ipnStatus: results[i].ipn_status,
                count: results[i].totalPayments,
                fees: {
                    depositFee: parseFloat(results[i].totalDepositFee).toFixed(2),
                    sendFee: parseFloat(results[i].totalNetworkFee).toFixed(8),
                    sendFeeUsd: parseFloat(results[i].totalNetworkFeeUsd).toFixed(2)
                },
                createdByApiKey: results[i].createdByApiKey
            }

            orders.push(orderObj);

        }

        return orders;

        await SQL.usdt_tx_batches.findAll({
                where: whereClause,
                order: arrOrder
            }).then(async(txs) => {
                //no orders
                if (!txs || (txs.length < 1)) {
                    return orderObj
                }

                //Get all payment addresses and put it in an array, we will call these in one go.
                for (let i = 0; i < txs.length; i++) {
                    orderObj = {
                            orderId: txs[i].orderId,
                            status: txs[i].status,
                            node: txs[i].node,
                            token: txs[i].token,
                            amount: parseFloat(txs[i].amount).toFixed(2),
                            received: 0,
                            address: txs[i].paymentAddr,
                            created: txs[i].createdEpoch,
                            confirmed: txs[i].confirmedEpoch,
                            ipnStatus: txs[i].ipn_status,
                            sumFees: 0,
                            createdByApiKey: txs[i].createdByApiKey
                        }
                        //orders.push(tx.orderId)
                    await SQL.usdt_clear_batches.findAll({
                        where: {
                            merchantId: merchantId,
                            orderId: txs[i].orderId,
                            status: {
                                [lib.Op.notIn]: ["INVALID", 'OPEN']
                            }
                        }
                    }).then(async(cleared) => {
                        //Total received taken from SQL because RPC would be significantly slower.
                        var total = 0
                        var count = cleared.length //num of forwarded deposits
                        var depositFee = null
                        var sendFeeUsd = null
                        var sendFee = null
                        if (cleared.length > 0) {
                            cleared.forEach((clear, index) => {
                                total += parseFloat(clear.amount)
                                depositFee += parseFloat(clear.amount * clear.fee)
                                sendFeeUsd += parseFloat(clear.sendFeeUsd)
                                sendFee += parseFloat(clear.sendFee)
                            })
                        }
                        orderObj.received = parseFloat(total).toFixed(2)
                        orderObj.fees = {
                            count: count,
                            depositFee: parseFloat(depositFee).toFixed(2),
                            sendFee: parseFloat(sendFee).toFixed(8),
                            sendFeeUsd: parseFloat(sendFeeUsd).toFixed(2)
                        }
                    })
                    orders.push(orderObj)
                    orderObj = {} //clear
                }
            }).catch((e) => {
                return e
            })
            //console.log(orders)
        return orders
    } //end of fetchOrders

const fetchAPIKeys = async(merchantId) => {
        var keys = []
        var obj = {}

        await SQL.api_keys.findAll({
                where: {
                    merchantId: merchantId
                }
            }).then((keypairs) => {
                if (keypairs.length > 0) {
                    keypairs.forEach(async(keypair, index) => {
                        obj = {
                            label: keypair.label,
                            key: keypair.apiKey,
                            //secret: keypair.secretKey, //should not return secrets.
                            isActive: keypair.isActive,
                            created: keypair.epoch
                        }
                        keys.push(obj)
                        obj = {} //clear
                    })
                }

            }).catch((e) => {
                return {
                    error: e
                }
            })
            //console.log(keys)
        return keys
    } //end of fetchAPIKeys

const changePassword = async(userObj, password) => {

        //encrypt password
        lib.bcrypt.hash(password, lib.CONFIG.SALT_ROUNDS, async function(err, hash) {
            if (err) {
                console.log("-E- " + err)
                return {
                    error: "Unable to change account password."
                }
            } //end of if err

            await userObj.update({
                    password: hash
                }).catch((e) => {
                    log.error(e)
                    return {
                        "error": e
                    }
                }) //end of catch
            return true
        })
    } //end of changePassword

const nextWithdrawBal = async(merchantId, feePercent, amount, paramNodeToken = null) => {

        let supportedTokens = await SQL.supportedTokens.findAll();

        let balObj = {};

        for (let data of supportedTokens) {

            let node = data.st_node;
            let token = data.st_token;
            let nodeToken = node + '_' + token;

            if (paramNodeToken != null && paramNodeToken != nodeToken) {
                continue;
            }

            var withdrawalBal = await fetchWithdrawBal(merchantId, false)
            withdrawalBal = withdrawalBal[node][token];

            var markupFeeUsd = await markupEstimateFeeUsd(nodeToken);

            var wB = withdrawalBal.balance
            var nextWithdrawableBal = ((wB - amount) - markupFeeUsd) / (100 + (feePercent * 100)) * 100

            if (balObj[node] == undefined) {
                balObj[node] = {};
            }

            balObj[node][token] = nextWithdrawableBal;

        }

        // var nextWithdrawableBal = wB - amount - (wB * feePercent) - markupFeeUsd
        //nextWithdrawableBal = nextWithdrawableBal - (nextWithdrawableBal * fee)

        return balObj
    } //end of nextWitdrawableBal

const fetchIpnHistory = async(merchantId) => {

        try {

            let results = await SQL.db.query(`
            SELECT * from ipn_history join usdt_tx_batches on ipn_orderId = orderId where ipn_merchantId = :merchantId
        `, {
                replacements: {
                    merchantId: merchantId
                },
                type: SQL.db.QueryTypes.SELECT
            });

            let returnObj = [];

            for (let row of results) {

                let ipnObj = {
                    ipn_id: row.ipn_id,
                    ipn_orderId: row.ipn_orderId,
                    ipn_paymentAddr: row.ipn_paymentAddr,
                    ipn_transactionAmt: row.ipn_transactionAmt,
                    ipn_currentReceived: row.ipn_currentReceived,
                    ipn_totalReceived: row.ipn_totalReceived,
                    ipn_status: row.ipn_status,
                    ipn_times_sent: row.ipn_times_sent,
                    ipn_lastSent_epoch: row.ipn_lastSent_epoch,
                    ipn_epoch: row.ipn_epoch,
                    node: row.node,
                    token: row.token
                }

                returnObj.push(ipnObj);
            }

            return returnObj;

        } catch (err) {
            console.log(err)
            throw err;
        }

    } //end of fetchIpnHistory



// Add markup (50%) to estimated transaction fee
//default 405 bytes per transaction for (funding type)
//default estimate fee for transaction to be mined within 6 blocks (10mins per block)
const markupEstimateFeeUsd = async(nodeToken, markup = 50, size = 405, blocks = 6) => {

    try {

        let [node, token] = nodeToken.split('_');

        let markupFee = await SQL.db.query(`
            SELECT 
                conf_value * ( ( 100 + ? ) / 100 ) as res 
            from configs 
            where conf_cat1 = 'NETWORK_FEE' 
            and conf_cat2 = ? 
            and conf_cat3 = ?`, {
            replacements: [markup, node, token],
            type: SQL.db.QueryTypes.SELECT
        });

        return markupFee[0].res;

    } catch (err) {
        throw err;
    }
}


module.exports = {

        getUser: async function(req) {
            let userObj = {}

            if (req.user != undefined) {
                await SQL.users.findOne({
                    where: {
                        id: req.user.id,
                        isActive: true
                    }
                }).then((user) => {
                    userObj = user
                }).catch((e) => {
                    return {
                        error: "Something went wrong, please try again later."
                    };
                })
            } else {
                return {
                    error: "User undefined."
                }
            }
            return userObj
        }, //end of getUser

        /**
         * Registers merchant
         * @param {name} Name of User
         * @param {email} 
         * @param {orgName} optional
         * @param {password} after md5
         * @return {200} Returns status, id, email.
         */
        registerUser: async function(req, res) {
            var name = req.body.name || null
            var email = req.body.email || null
            var password = req.body.password || null
            var orgName = req.body.orgName || null
            var mobileNum = req.body.mobileNum || null
            var country = req.body.country || null

            if (!name || !email || !password || !orgName || !mobileNum || !country || (typeof password != 'string') || (typeof name != 'string') || (typeof email != 'string')) {
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

                            let merchantId = await lib.uniqid.time()
                                //console.log(merchantId)
                            await SQL.users.create({
                                    merchantId: merchantId,
                                    name: name,
                                    email: email,
                                    password: hash,
                                    orgName: orgName,
                                    mobileNum: mobileNum,
                                    country: country,
                                    createdEpoch: Math.floor(new Date() / 1000)
                                }).then(async() => {
                                    await SQL.users.findOne({
                                            where: {
                                                merchantId: merchantId
                                            }
                                        }).then(async(queriedUser) => {
                                            //send account verification link
                                            sendVeriLink(queriedUser)
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

        loginUser: async function(req, res) {
            var email = req.body.email || null
            var password = req.body.password || null
            var wallet = 0
            var orderDetails = {}
            var fees = {}

            if (!email || !password) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            var user = await getUserObj(email) || null
            if (!user) {
                res.status(400).json({
                    success: false,
                    message: "Merchant account not registered."
                })
                return
            }

            fees = {
                deposit: user.fee,
                withdraw: user.withdraw_fee
            }

            await lib.bcrypt.compare(password, user.password, async function(err, result) {
                    if (result) {
                        //password matched
                        //generate json web token
                        let token = await lib.jwt.sign({
                            id: user.id
                        }, lib.CONFIG.ENDPOINTS.SECRET, {
                            expiresIn: 900 //equivalent to 15 mins.
                                //expiresIn: 9999999 // uncomment for -DEV- purposes
                        })

                        //fetch USDT balances
                        wallet = await fetchWithdrawBal(user.merchantId)
                            //console.log(wallet)

                        //fetch Orders
                        orderDetails = await fetchOrderCount(user.merchantId)
                            //console.log(orderDetails)

                        let authMethod = (user.otp_secret !== null) ? 'OTP' : 'EMAIL';

                        res.status(200).json({
                            success: true,
                            isVerified: user.isVerified,
                            merchantId: user.merchantId,
                            name: user.name,
                            orgName: user.orgName,
                            country: user.country,
                            mobileNum: user.mobileNum,
                            fees: fees,
                            wallet: wallet,
                            orders: orderDetails,
                            jwtToken: token,
                            isAdmin: user.isAdmin,
                            authMethod: authMethod
                        });

                        let ipAddr = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress; //Log ip address.

                        try {

                            let apiKey = lib.CONFIG.IPDATA.APIKEY;
                            let apiUrl = `https://api.ipdata.co/${ipAddr}?api-key=${apiKey}`;

                            let options = {
                                uri: apiUrl,
                                headers: {
                                    "Content-type": "application/json",
                                    "Accept": "application/json",
                                    "Accept-Charset": "utf-8"
                                },
                                json: true // Automatically parses the JSON string in the response
                            };

                            lib.requestpn(options).then(result => {
                                return result;

                            }).catch(err => {
                                // console.log(err);
                                return err;
                            }).then(response => {

                                let location = (response.error != undefined) ? null : `Lat: ${response.latitude}, Long: ${response.longitude}, City: ${response.city}, Region: ${response.region}, Country: ${response.country_name}, Continent: ${response.continent_name} `;

                                let date = new Date().toString();

                                SQL.user_activity_logs.create({
                                    ual_merchantId: user.merchantId,
                                    ual_category: 'LOG',
                                    ual_message: `Login IP: ${ipAddr} || Date: ${date} || Location: ${location || 'N/A'}`,
                                    ual_newVal: JSON.stringify(response)
                                });


                                lib.juice.juiceFile(__dirname + '/../templates/login_logging.html', null, async(err, html) => {

                                    if (err) {
                                        console.log(err);
                                        return;
                                    }

                                    html = html.replace('ip_address_placeholder', ipAddr);
                                    html = html.replace('date_time_placeholder', date);
                                    html = html.replace('latitude_placeholder', response.latitude || 'N/A');
                                    html = html.replace('longitude_placeholder', response.longitude || 'N/A');
                                    html = html.replace('city_placeholder', response.city || 'N/A');
                                    html = html.replace('region_placeholder', response.region || 'N/A');
                                    html = html.replace('country_placeholder', response.country_name || 'N/A');
                                    html = html.replace('continent_placeholder', response.continent_name || 'N/A');

                                    //set mail options
                                    let mailOptions = {
                                        from: lib.CONFIG.EMAIL_VERILINK.FROM,
                                        to: user.email,
                                        subject: 'New login from ' + response.city + ', ' + response.country_name + '.',
                                        html: html,
                                        }

                                    let transporter = lib.nodemailer.createTransport({
                                        host: lib.CONFIG.EMAIL_VERILINK.HOST,
                                        port: lib.CONFIG.EMAIL_VERILINK.PORT,
                                        secure: true, // upgrade later with STARTTLS
                                        auth: {
                                            user: lib.CONFIG.EMAIL_VERILINK.ADDRESS,
                                            pass: lib.CONFIG.EMAIL_VERILINK.PASSWORD
                                        },
                                        tls: {
                                            rejectUnauthorized: false
                                        }
                                    });

                                    transporter.sendMail(mailOptions, async function(error, info) {
                                        if (error) {
                                            console.log(error)
                                            throw error;
                                        }
                                    });

                                });

                            });

                        } catch (err) {
                            throw err;
                        }

                    } else {
                        res.status(400).json({
                            success: false,
                            message: "Incorrect password or merchant email."
                        });
                    } //end of else
                }) //end of bcrypt compare
        }, //end of loginUser

        forgotPassword: async function(req, res) {
            var email = req.body.email || null
            if (!email) {
                //user already exist, return
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            var user = await getUserObj(email)
            if (!user) {
                res.status(400).json({
                    success: false,
                    message: "Merchant account not registered."
                })
                return
            } else {
                
                //send email reset password link
                var result = emailResetPass(user)
                if (result.error) {
                    res.status(400).json({
                        success: false,
                        message: "Failed to send reset instructions, please try again later."
                    })
                    return
                } else {
                    res.status(200).json({
                        success: true,
                        email: user.email,
                        message: "Password reset instructions had been sent to registered email."
                    })
                }
                return
            }
        }, //end of forgotPassword

        getResetInfo: async function(req, res) {
            var url = new URL(lib.CONFIG.DOMAIN + req.url) || null
            var code = url.searchParams.get("v") || null

            if (!code) {
                res.status(400).json({
                    success: false,
                    message: "Something went wrong, please try again later."
                })
                return
            }

            await SQL.users.findOne({
                where: {
                    vericode: code
                }
            }).then((user) => {
                if (!user) {
                    res.status(400).json({
                        success: false,
                        message: "Link may have expired, please perform password reset once again."
                    })
                    return
                }
                res.status(200).json({
                    success: true,
                    merchantId: user.merchantId,
                    email: user.email,
                    name: user.name,
                    orgName: user.orgName
                })
                return
            }).catch((err) => {
                res.status(400).json({
                    success: false,
                    message: "Something went wrong, please try again later."
                })
                return
            })
        }, //end of getResetInfo

        getUserInfo: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            var walletBal = await fetchWithdrawBal(user.merchantId)
            var orderDetails = await fetchOrderCount(user.merchantId)
            var keypairs = await fetchAPIKeys(user.merchantId)
            var fees = {
                deposit: Number(user.fee),
                withdraw: Number(user.withdraw_fee)
            }

            var omniFeeUsd = await markupEstimateFeeUsd('OMNI_USDT');
            omniFeeUsd = omniFeeUsd.toFixed(2);

            let isPaused = (omniFeeUsd > lib.CONFIG.MAX_SEND_FEE) ? true : false;

            let authMethod = (user.otp_secret !== null) ? 'OTP' : 'EMAIL';

            let results = await SQL.supportedTokens.findAll();

            let supportedTokens = [];

            for (let rowData of results) {
                supportedTokens.push({
                    node: rowData.st_node,
                    token: rowData.st_token,
                    active: rowData.st_active
                })
            }

            res.status(200).json({
                success: true,
                isVerified: user.isVerified,
                isAdmin: user.isAdmin,
                kycStatus: user.kycStatus,
                registeredOn: user.createdEpoch,
                merchantId: user.merchantId,
                name: user.name,
                email: user.email,
                orgName: user.orgName,
                country: user.country,
                mobileNum: user.mobileNum,
                wallet: walletBal,
                orders: orderDetails,
                apiKeys: keypairs,
                fees: fees,
                isWithdrawing: user.isWithdrawing,
                ipn: user.ipn_url,
                isIPNHandle: user.ipn_handle,
                isPaused: isPaused,
                isForcePush: user.forceTx,
                estimatedOmniTxFee: omniFeeUsd,
                maxFeeLimit: lib.CONFIG.MAX_SEND_FEE,
                authMethod: authMethod,
                supportedTokens: supportedTokens
            })
        }, //end of getUserInfo

        getOrders: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            var merchantId = user.merchantId || null
            var orders = {}

            if (!merchantId || merchantId == null) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            let params = (req.query.hasOwnProperty("params")) ? JSON.parse(req.query.params) : null;

            //fetch orders & it's received amount
            orders = await fetchOrders(merchantId, params)
            res.status(200).json({
                success: true,
                orders: orders
            })
        }, //end of getOrders

        preCheckWithdraw: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            if (user.isWithdrawing) {
                res.status(400).json({
                    success: false,
                    message: "Your bulk withdrawals are being scheduled, it should take 1 - 5 mins."
                })
                return
            }

            var merchantId = user.merchantId || null
            var amount = Number(req.body.amount) || null
            var addr = req.body.address || null
            var node = req.body.node || null
            var token = req.body.token || null

            let nodeToken = node + '_' + token;

            if (!merchantId || merchantId == null || !amount || !addr || !node || !token) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            //check if wtihdraw amount is higher than minimum withdraw amount.
            // if (Number(amount) < lib.CONFIG.MIN_USDT_WITHDRAW_AMOUNT) {
            //     res.status(400).json({
            //         success: false,
            //         message: "Amount is less than minimum required " + lib.CONFIG.MIN_USDT_WITHDRAW_AMOUNT + " USDT amount."
            //     })
            //     return
            // }

            //check if amount is withdrawable
            var withdraw = await fetchWithdrawBal(user.merchantId, false)
                //log.debug(withdraw.balance + " " + withdraw.withdrawableBal)

            withdraw = withdraw[node][token];

            if (amount <= 0) {
                res.status(400).json({
                    success: false,
                    message: "Withdrawal amount cannot be less than or equal to 0."
                })
                return
            }

            // Rounds withdrawableBal to 1 cent (00.01)
            if (amount > (withdraw.withdrawableBal + 0.005).toFixed(2)) {
                res.status(400).json({
                    success: false,
                    message: "Withdrawal amount " + Number(amount) + " larger than max withdrawable amount of " + parseFloat(withdraw.withdrawableBal).toFixed(2) + " USDT."
                })
                return
            }

            //check if receiving address is a valid address
            let valParams = {
                coinType: nodeToken,
                address: addr
            }
            var valid = await lib.walletObj.validateAddr(valParams);

            if (!valid) {
                res.status(400).json({
                    success: false,
                    message: "Withdrawal wallet address is invalid."
                })
                return
            }

            var withdrawFee = ((amount * user.withdraw_fee) + withdraw.estimatedTxFee).toFixed(2);

            if (amount == withdraw.withdrawableBal.toFixed(2)) {
                withdrawFee = (withdraw.balance * user.withdraw_fee) + withdraw.estimatedTxFee;
            }

            var deducted = Number(withdrawFee) + amount;
            var newBal = Number(withdraw.balance) - Number(deducted);

            var details = {
                amount: amount,
                withdrawFee: parseFloat(withdrawFee).toFixed(2),
                estimatedTxFee: parseFloat(withdraw.estimatedTxFee).toFixed(2),
                deducted: parseFloat(deducted).toFixed(2),
                newBal: parseFloat(newBal).toFixed(2)
            }

            //Respond with confirmation details
            //amount, fee, totalDeducted, newBal
            res.status(200).json({
                success: true,
                currBal: parseFloat(withdraw.balance).toFixed(2),
                confirmation: details
            })
            return
        }, //end of preCheckWithdraw

        withdrawUSDT: async function(req, res) {
            //*****Verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            //check if withdraw job is still scheduling
            if (user.isWithdrawing) {
                res.status(400).json({
                    success: false,
                    message: "There are withdrawal jobs being scheduled, please wait for it to be completed."
                });
                return
            }

            var maxWithdrawable = 0
            var amount = Number(req.body.amount) || null
            var withdrawAddr = req.body.withdrawAddr || null
            var code2fa = req.body.code2fa || null
            var displayedEstFee = req.body.displayedEstFee || null
            var node = req.body.node || null
            var token = req.body.token || null

            if (!amount || (amount == null) || (typeof amount != 'number') || !withdrawAddr || (withdrawAddr == null) || !code2fa || (code2fa == null) ||
                !displayedEstFee || (displayedEstFee == null) || !node || (node == null) || !token || (token == null)) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            if (!user.isVerified) {
                res.status(200).json({
                    success: false,
                    message: "User is not verified; Account verification required for withdrawal."
                })
                return
            }

            if (user.kycStatus !== "APPROVED") {
                res.status(200).json({
                    success: false,
                    message: "Please complete account KYC verification."
                })
                return
            }

            // if (withdrawalId.length > 250) {
            //     res.status(400).json({
            //         success: false,
            //         message: "Withdrawal ID cannot be longer than 250 characters"
            //     })
            //     return
            // }

            // if (Number(amount) < lib.CONFIG.MIN_USDT_WITHDRAW_AMOUNT) {
            //     res.status(400).json({
            //         success: false,
            //         message: "Withdrawal amount is less than minimum required " + lib.CONFIG.MIN_USDT_WITHDRAW_AMOUNT + " USDT amount."
            //     })
            //     return
            // }

            //check if request amount leaves enough balance for next withdrawal.
            // var wB = await nextWithdrawBal(user.merchantId, user.withdraw_fee, amount)
            // wB = parseFloat(wB).toFixed(2)
            //     //log.debug(wB)
            // if ((wB < lib.CONFIG.MIN_USDT_WITHDRAW_AMOUNT) && (wB > 0)) {
            //     res.status(400).json({
            //         success: false,
            //         message: "Unable to perform withdrawal request because that gives you a remaining balance of " + wB + " which is less than required minimum withdrawal amount of " + lib.CONFIG.MIN_USDT_WITHDRAW_AMOUNT + " USDT for your next withdrawal. Kindly consider a full withdrawal."
            //     })
            //     return
            // }

            let nodeToken = node + '_' + token;

            //check to see if address is valid
            let valParams = {
                coinType: nodeToken,
                address: withdrawAddr
            }
            var valid = await lib.walletObj.validateAddr(valParams);

            if (!valid) {
                res.status(400).json({
                    success: false,
                    message: "Withdrawal wallet address is invalid."
                })
                return
            }

            let withdraw = await fetchWithdrawBal(user.merchantId);
            withdraw = withdraw[node][token];

            maxWithdrawable = parseFloat(withdraw.withdrawableBal).toFixed(2);

            // Check if transaction fee has increased since the amount displayed on screen
            if (displayedEstFee < parseFloat(withdraw.estimatedTxFee).toFixed(2)) {
                res.status(400).json({
                    success: false,
                    withdrawableBal: parseFloat(maxWithdrawable),
                    amount: amount,
                    recipient: withdrawAddr,
                    message: "The transaction fee has increased please try again."
                });
                return
            }

            if (amount <= 0) {
                res.status(400).json({
                    success: false,
                    withdrawableBal: parseFloat(maxWithdrawable),
                    amount: amount,
                    recipient: withdrawAddr,
                    message: "Withdrawal amount cannot be less than or equal to 0."
                });
                return
            }

            //check if merchant is trying to withdraw more than balance
            if ((maxWithdrawable - amount) < 0) {
                res.status(400).json({
                    success: false,
                    withdrawableBal: parseFloat(maxWithdrawable),
                    amount: amount,
                    recipient: withdrawAddr,
                    message: "Unable to withdraw more than balance."
                })
                return
            } else {

                //check if 2fa code is valid
                if (!await utility.validate2fa(user.merchantId, code2fa)) {
                    res.status(400).json({
                        success: false,
                        withdrawableBal: parseFloat(maxWithdrawable),
                        amount: amount,
                        recipient: withdrawAddr,
                        message: "Invalid 2FA code."
                    })
                    return
                }

                var message =
                    "Withdrawal Request\n" +
                    "User: " + user.orgName + "\n" +
                    "2FA Used: " + code2fa + "\n" +
                    "Amount: " + nbr(amount) + " " + nodeToken + "\n" +
                    "Max Withdrawable: " + nbr(maxWithdrawable) + " USDT\n";
                console.log("-D- ", message)
                await lib.bot.sendMonGrpMessage(message);

                //all is good to go, let's proceed for withdrawal submission!
                {

                    let withdrawalVerifyAmt = parseFloat(lib.CONFIG.WITHDRAWAL_VERIFY_AMT);
                    let maxDefault = await SQL.configs.findOne({
                        where: {
                            conf_cat1: "MAX_WITHDRAW",
                            conf_cat2: token
                        }
                    });

                    withdrawalVerifyAmt = parseFloat(maxDefault.conf_value);

                    let status = 'OPEN';

                    // If withdrawal amount is very high. Do not immediately push. Need to be verified by a human
                    if (amount > withdrawalVerifyAmt) {
                        status = 'PEND_VERIFY';

                        var message =
                            "Large Withdrawal Detected\n" +
                            "User: " + user.orgName + "\n" +
                            "Amount: " + nbr(amount) + " " + nodeToken + "\n" +
                            "Max Auto Amt: " + nbr(withdrawalVerifyAmt) + " USDT\n";
                        console.log("-D- ", message)
                        await lib.bot.sendMonGrpMessage(message);
                    }

                    var currEpoch = Math.floor(new Date())
                        // Generate unique withdrawalId associated with merchantId and current epoch
                    var withdrawalId = lib.md5(user.merchantId + currEpoch.toString())

                    //schedule withdrawal tx
                    await SQL.withdrawals.create({
                        merchantId: user.merchantId,
                        withdrawalId: withdrawalId.substring(0, 12), //truncate withdrawalId to length of 12 characters
                        createdEpoch: Math.floor(new Date() / 1000),
                        node: node,
                        token: token,
                        type: 'SINGLE',
                        amount: amount,
                        fee: user.withdraw_fee,
                        resellerFee: user.reseller_fee,
                        chargedSendFeeUsd: displayedEstFee,
                        destinationAddr: withdrawAddr,
                        status: status
                    }).then(async() => {
                        //calling fetchWithdrawBal because withdrawal tx had just been scheduled.
                        var newWithdrawableBal = await fetchWithdrawBal(user.merchantId)
                        res.status(200).json({
                            success: true,
                            status: status,
                            balance: newWithdrawableBal,
                            recipient: withdrawAddr,
                            message: "Withdrawal Successful"
                        })

                        return
                    }).catch(e => {
                        console.log("-E-", e)
                        res.status(400).json({
                            success: false,
                            message: "Something went wrong, please try again later."
                        })
                    })
                }
            }
        }, //end of withdrawUSDT

        preBulkWithdrawUSDT: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(200).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            if (user.isWithdrawing) {
                res.status(200).json({
                    success: false,
                    message: "Your bulk withdrawals are being scheduled, it should take 1 - 5 mins."
                })
                return
            }

            var merchantId = user.merchantId

            //check if withdraw job is still scheduling
            if (user.isWithdrawing) {
                res.status(200).json({
                    success: false,
                    message: "Previous withdrawal job is being scheduled, please wait for it to be completed."
                });
                return
            }

            if (!user.isVerified) {
                res.status(200).json({
                    success: false,
                    message: "User is not verified; Account verification required for withdrawal."
                })
                return
            }

            if (user.kycStatus !== "APPROVED") {
                res.status(200).json({
                    success: false,
                    message: "Please complete account KYC verification."
                })
                return
            }

            //check for file
            if (!req.files || !req.body.checksum || !req.body.node || !req.body.token) {
                res.status(200).json({
                    success: false,
                    message: "No file selected for upload, no checksum specified or missing 2FA code."
                });
                return
            }

            var file = req.files.file || null
            var checksumClient = req.body.checksum
            var node = req.body.node
            var token = req.body.token
            var checksumServer = ''

            let nodeToken = node + '_' + token;

            //check file type is csv
            if ((file == null) || (file.mimetype != 'text/csv' && file.mimetype != 'application/vnd.ms-excel')) {
                res.status(200).json({
                    success: false,
                    message: "Invalid file format, expect csv."
                })
                return
            }

            //prevent image upload of more than 2MB
            if (file.size > 2000000) {
                res.status(200).json({
                    success: false,
                    message: "CSV file size should not be larger than 2MB."
                });
                return
            }

            //create temp file from buffer since md5-file requires path to file
            var pathFile = '/tmp/' + checksumClient + '.csv'
            if (lib.fs.existsSync(pathFile)) {
                log.debug("File already exists: " + pathFile)
                checksumServer = await lib.md5File.sync(pathFile)
                    //check if file hash is the same
                    //To ensure that file has not been tampered and file contains no missing or additional data.
                    /*
                if (checksumClient != checksumServer) {
                    res.status(200).json({
                        success: false,
                        message: "Checksum value does not match."
                    })
                    return
                }
                */

                var withdrawals = []
                var totalAmount = 0
                var withdrawCount = 0
                var arrAddresses = [];

                lib.csv.fromPath(pathFile)
                    .on("data", function(data) {

                        let address = data[0];
                        let amount = Number(parseFloat(data[1]).toFixed(2));

                        if (arrAddresses[address] == undefined) {
                            arrAddresses[address] = 1;
                        } else {
                            arrAddresses[address]++;
                        }

                        withdrawals.push({
                            address: address,
                            amount: amount
                        });
                    })
                    .on("end", async function() {

                        for (var index in withdrawals) {

                            //check for empty amount
                            if (withdrawals[index].amount <= 0 || withdrawals[index].amount == "") {
                                res.status(200).json({
                                    success: false,
                                    message: "One of the amount is invalid or is zero. (" + withdrawals[index].address + ")"
                                })
                                return
                            }

                            //Check to see if address is valid
                            let valParams = {
                                coinType: nodeToken,
                                address: withdrawals[index].address
                            }
                            var valid = await lib.walletObj.validateAddr(valParams);

                            if (!valid) {
                                res.status(200).json({
                                    success: false,
                                    message: "Wallet addresses (" + withdrawals[index].address + ") or type is invalid."
                                })
                                return
                            }

                            totalAmount += Number(parseFloat(withdrawals[index].amount).toFixed(2))
                            withdrawCount++

                            //Check bulk withdraw ammount limit
                            let maxBulkWithdrawAmt = await SQL.configs.findOne({
                                where: {
                                    conf_code: "MAX_USDT_BULK_WITHDRAW_AMT",
                                    conf_cat1: "MAX_WITHDRAW",
                                    conf_cat2: "USDT"
                                }
                            });
                            if (totalAmount > maxBulkWithdrawAmt.conf_value) {
                                res.status(400).json({
                                    success: false,
                                    message: `Withdraw amount exceeds ${maxBulkWithdrawAmt.conf_value}USDT limit.`
                                })
                                return
                            }
                        }

                        var withdrawObj = await fetchWithdrawBal(merchantId)
                        withdrawObj = withdrawObj[node][token];
                        var withdrawableBal = withdrawObj.withdrawableBal
                        var withdrawable = withdrawObj.balance
                        var totalChargedSendFees = withdrawCount * withdrawObj.estimatedTxFee;
                        var totalWithdrawFee = totalAmount * user.withdraw_fee;
                        var totalFee = totalWithdrawFee + totalChargedSendFees;

                        //check if merchant is trying to withdraw more than balance
                        if ((withdrawable - (totalAmount + Number(totalFee))) < 0) {
                            res.status(200).json({
                                success: false,
                                withdrawableBal: withdrawableBal,
                                total: totalAmount,
                                fee: parseFloat(totalFee).toFixed(2),
                                estimatedTxFee: parseFloat(withdrawObj.estimatedTxFee).toFixed(2),
                                message: "Available USDT balance is insufficient, required: " + parseFloat(totalAmount + Number(totalFee)).toFixed(2) + " USDT"
                            })
                            return
                        }

                        //check if request amount leaves enough balance for next withdrawal.
                        var wB = await nextWithdrawBal(merchantId, user.withdraw_fee, totalAmount, nodeToken)
                        wB = wB[node][token];
                        wB = parseFloat(wB).toFixed(2)

                        let newBal = withdrawable - totalAmount - totalFee;

                        res.status(200).json({
                            success: true,
                            count: withdrawCount,
                            checksum: checksumClient,
                            estimatedNetworkFee: parseFloat(withdrawObj.estimatedTxFee).toFixed(2),
                            totalAmt: parseFloat(totalAmount).toFixed(2),
                            totalNetworkFee: parseFloat(totalChargedSendFees).toFixed(2),
                            totalWithdrawFee: parseFloat(totalWithdrawFee).toFixed(2),
                            totalFee: parseFloat(totalFee).toFixed(2),
                            totalDeducted: parseFloat(Number(totalAmount) + Number(totalFee)).toFixed(2),
                            newBalance: newBal.toFixed(2)
                        })
                        return
                        // } //end of else
                    })
            } else {
                var wstream = lib.fs.createWriteStream(pathFile)
                wstream.write(file.data, async() => {
                        wstream.end()
                        checksumServer = await lib.md5File.sync(pathFile)

                        var withdrawals = []
                        var totalAmount = 0
                        var withdrawCount = 0
                        var arrAddresses = []

                        lib.csv.fromPath(pathFile)
                            .on("data", function(data) {
                                let address = data[0];
                                let amount = Number(parseFloat(data[1]).toFixed(2));

                                if (arrAddresses[address] == undefined) {
                                    arrAddresses[address] = 1;
                                } else {
                                    arrAddresses[address]++;
                                }

                                withdrawals.push({
                                    address: address,
                                    amount: amount
                                });
                            })
                            .on("end", async function() {

                                for (var index in withdrawals) {

                                    //check for empty amount
                                    if (withdrawals[index].amount <= 0 || withdrawals[index].amount == "") {
                                        res.status(200).json({
                                            success: false,
                                            message: "One of the amount is invalid or is zero. (" + withdrawals[index].address + ")"
                                        })
                                        return
                                    }

                                    //Check to see if address is valid
                                    let valParams = {
                                        coinType: nodeToken,
                                        address: withdrawals[index].address
                                    }
                                    var valid = await lib.walletObj.validateAddr(valParams);
                                    if (!valid) {
                                        res.status(200).json({
                                            success: false,
                                            message: "Wallet addresses (" + withdrawals[index].address + ") or type is invalid."
                                        })
                                        return
                                    }

                                    totalAmount += Number(parseFloat(withdrawals[index].amount).toFixed(2))
                                    withdrawCount++

                                    //Check bulk withdraw ammount limit
                                    let maxBulkWithdrawAmt = await SQL.configs.findOne({
                                        where: {
                                            conf_code: "MAX_USDT_BULK_WITHDRAW_AMT",
                                            conf_cat1: "MAX_WITHDRAW",
                                            conf_cat2: "USDT"
                                        }
                                    });
                                    if (totalAmount > maxBulkWithdrawAmt.conf_value) {
                                        res.status(400).json({
                                            success: false,
                                            message: `Withdraw amount exceeds ${maxBulkWithdrawAmt.conf_value}USDT limit.`
                                        })
                                        return
                                    }
                                }

                                var withdrawObj = await fetchWithdrawBal(merchantId)
                                withdrawObj = withdrawObj[node][token];
                                var withdrawableBal = withdrawObj.withdrawableBal
                                var withdrawable = withdrawObj.balance
                                var totalChargedSendFees = withdrawCount * withdrawObj.estimatedTxFee;
                                var totalWithdrawFee = totalAmount * user.withdraw_fee;
                                var totalFee = totalWithdrawFee + totalChargedSendFees;

                                //check if merchant is trying to withdraw more than balance
                                if ((withdrawable - (totalAmount + Number(totalFee))) < 0) {
                                    res.status(200).json({
                                        success: false,
                                        withdrawableBal: withdrawableBal,
                                        total: totalAmount,
                                        fee: parseFloat(totalFee).toFixed(2),
                                        message: "Available USDT balance is insufficient."
                                    })
                                    return
                                }

                                //check if request amount leaves enough balance for next withdrawal.
                                var wB = await nextWithdrawBal(merchantId, user.withdraw_fee, totalAmount, nodeToken)
                                wB = wB[node][token];
                                wB = parseFloat(wB).toFixed(2)


                                let newBal = withdrawable - totalAmount - totalFee;

                                res.status(200).json({
                                    success: true,
                                    count: withdrawCount,
                                    checksum: checksumClient,
                                    estimatedNetworkFee: parseFloat(withdrawObj.estimatedTxFee).toFixed(2),
                                    totalAmt: parseFloat(totalAmount).toFixed(2),
                                    totalNetworkFee: parseFloat(totalChargedSendFees).toFixed(2),
                                    totalWithdrawFee: parseFloat(totalWithdrawFee).toFixed(2),
                                    totalFee: parseFloat(totalFee).toFixed(2),
                                    totalDeducted: parseFloat(Number(totalAmount) + Number(totalFee)).toFixed(2),
                                    newBalance: newBal.toFixed(2)
                                })
                                return
                                // } //end of else
                            })
                    }) // end of wstream write
            }
        }, //end of preBulkWithdrawUSDT

        bulkWithdrawUSDT: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(200).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }
            var merchantId = user.merchantId

            //check if withdraw job is still scheduling
            if (user.isWithdrawing) {
                res.status(200).json({
                    success: false,
                    message: "Previous withdrawal job is being scheduled, please wait for it to be completed."
                });
                return
            }

            if (!user.isVerified) {
                res.status(200).json({
                    success: false,
                    message: "User is not verified; Account verification required for withdrawal."
                })
                return
            }

            if (user.kycStatus !== "APPROVED") {
                res.status(200).json({
                    success: false,
                    message: "Please complete account KYC verification."
                })
                return
            }

            if (!req.body.checksum || !req.body.code2fa || !req.body.displayedEstFee || !req.body.node || !req.body.token) {
                res.status(200).json({
                    success: false,
                    message: "No checksum specified or missing 2FA code or missing estimated fee."
                });
                return
            }

            var code2fa = req.body.code2fa
            var checksumClient = req.body.checksum
            var pathFile = '/tmp/' + checksumClient + '.csv'
            var displayedEstFee = req.body.displayedEstFee
            var node = req.body.node
            var token = req.body.token

            let nodeToken = node + '_' + token;

            //check if 2fa code is valid
            if (!await utility.validate2fa(merchantId, code2fa)) {
                res.status(200).json({
                    success: false,
                    message: "Invalid 2FA code."
                })
                return
            }

            //check if precheck was carried out to check uploaded file
            if (!lib.fs.existsSync(pathFile)) {
                //pre check wasn't carried out.
                res.status(200).json({
                    success: false,
                    checksum: checksumClient,
                    message: "Please confirm withdrawal details before confirming bulk withdrawal."
                });
                return
            }

            let checksumServer = await lib.md5File.sync(pathFile)

            var withdrawals = []
            var totalAmount = 0
            var withdrawCount = 0
            var arrAddresses = []

            lib.csv.fromPath(pathFile)
                .on("data", function(data) {

                    let address = data[0];
                    let amount = Number(parseFloat(data[1]).toFixed(2));

                    if (arrAddresses[address] == undefined) {
                        arrAddresses[address] = 1;
                    } else {
                        arrAddresses[address]++;
                    }

                    withdrawals.push({
                        node: node,
                        token: token,
                        address: address,
                        amount: amount
                    });
                })
                .on("end", async function() {

                    for (var index in withdrawals) {
                        //check for empty amount
                        if (withdrawals[index].amount <= 0 || withdrawals[index].amount == "") {
                            res.status(200).json({
                                success: false,
                                message: "One of the amount is invalid or is zero. (" + withdrawals[index].address + ")"
                            })
                            return
                        }

                        //Check to see if address is valid
                        let valParams = {
                            coinType: nodeToken,
                            address: withdrawals[index].address
                        }
                        var valid = await lib.walletObj.validateAddr(valParams);
                        if (!valid) {
                            res.status(200).json({
                                success: false,
                                message: "Wallet addresses (" + withdrawals[index].address + ") or type is invalid."
                            })
                            return
                        }

                        totalAmount += Number(parseFloat(withdrawals[index].amount).toFixed(2))
                        withdrawCount++

                        //Check bulk withdraw ammount limit
                        let maxBulkWithdrawAmt = await SQL.configs.findOne({
                            where: {
                                conf_code: "MAX_USDT_BULK_WITHDRAW_AMT",
                                conf_cat1: "MAX_WITHDRAW",
                                conf_cat2: "USDT"
                            }
                        });
                        if (totalAmount > maxBulkWithdrawAmt.conf_value) {
                            res.status(400).json({
                                success: false,
                                message: `Withdraw amount exceeds ${maxBulkWithdrawAmt.conf_value}USDT limit.`
                            })
                            return
                        }
                    }

                    var withdrawObj = await fetchWithdrawBal(merchantId)
                    withdrawObj = withdrawObj[node][token];
                    var withdrawableBal = withdrawObj.withdrawableBal
                    var withdrawable = withdrawObj.balance
                    var totalChargedSendFees = withdrawCount * withdrawObj.estimatedTxFee;
                    var totalFee = (totalAmount * user.withdraw_fee) + totalChargedSendFees

                    // let baseTxFee = (parseFloat(displayedEstFee).toFixed(2) / withdrawals.length);
                    let baseTxFee = Number(displayedEstFee);

                    // Check if transaction fee has increased since the amount displayed on screen
                    if (baseTxFee.toFixed(2) < parseFloat(withdrawObj.estimatedTxFee).toFixed(2)) {
                        res.status(200).json({
                            success: false,
                            withdrawableBal: withdrawableBal,
                            total: totalAmount,
                            fee: parseFloat(totalFee).toFixed(2),
                            message: "The transaction fee has increased please try again."
                        })
                        return
                    }

                    //check if merchant is trying to withdraw more than balance
                    if ((withdrawable - (totalAmount + Number(totalFee))) < 0) {
                        res.status(200).json({
                            success: false,
                            withdrawableBal: withdrawableBal,
                            total: totalAmount,
                            fee: parseFloat(totalFee).toFixed(2),
                            message: "Available USDT balance is insufficient."
                        })
                        return
                    }

                    //check if request amount leaves enough balance for next withdrawal.
                    var wB = await nextWithdrawBal(merchantId, user.withdraw_fee, totalAmount, nodeToken);
                    wB = wB[node][token];


                    let newBal = withdrawable - totalAmount - totalFee;

                    //all is good to go, let's proceed for bulk withdrawal submission!
                    {

                        await user.update({
                            isWithdrawing: true
                        });

                        let withdrawalVerifyAmt = parseFloat(lib.CONFIG.WITHDRAWAL_VERIFY_AMT);
                        let maxDefault = await SQL.configs.findOne({
                            where: {
                                conf_cat1: "MAX_WITHDRAW",
                                conf_cat2: token
                            }
                        });

                        withdrawalVerifyAmt = parseFloat(maxDefault.conf_value);
                        let status = 'OPEN';

                        // If withdrawal amount is very high. Do not immediately push. Need to be verified by a human
                        if (totalAmount > withdrawalVerifyAmt) {
                            status = 'PEND_VERIFY';

                            var message =
                                "*-WARNING1- Large Bulk Withdrawal Detected!*\n" +
                                "User: " + user.orgName + "\n" +
                                "Total Amount: " + totalAmount + " " + nodeToken + "\n" +
                                "Max Auto Amt: " + withdrawalVerifyAmt + " USDT\n";
                            await lib.bot.sendMonGrpMessage(message);
                        }

                        // Do not commit to DB if error occurs within transaction
                        SQL.db.transaction(async function(t) {

                            var promises = [];
                            let i = 0;
                            //Schedule all withdrawals from csv file
                            for (var index in withdrawals) {
                                i++;
                                var amount = withdrawals[index].amount
                                var walletBal = await fetchWithdrawBal(merchantId, false)
                                if ((walletBal.withdrawableBal - amount) < 0) {
                                    //Balance is insufficient, merchant must have somehow performed manual withdrawal while scheduling is not complete, or something bad happened.
                                    log.error("E1273:bulkWithdrawal schedule breaks in between due to insufficient balance; merchant must have somehow performed manual withdrawal while scheduling is not complete, or something bad happened.")
                                    break
                                }

                                //Generate unique withdrawalId on the fly
                                var currEpoch = Math.floor(new Date())
                                var withdrawalId = lib.md5(user.merchantId + i + currEpoch.toString())

                                //schedule withdrawal tx
                                var newPromise = SQL.withdrawals.create({
                                    merchantId: merchantId,
                                    withdrawalId: withdrawalId.substring(0, 12),
                                    createdEpoch: Math.floor(new Date() / 1000),
                                    node: withdrawals[index].node,
                                    token: withdrawals[index].token,
                                    type: 'BULK',
                                    amount: amount,
                                    fee: user.withdraw_fee,
                                    resellerFee: user.reseller_fee,
                                    chargedSendFeeUsd: baseTxFee,
                                    destinationAddr: withdrawals[index].address,
                                    status: status
                                }, {
                                    transaction: t
                                });

                                promises.push(newPromise);

                            } //end of for loop

                            return Promise.all(promises);

                        }).then(function() {

                            //Done scheduling all withdrawals or break, release withdrawals lock.
                            user.update({
                                isWithdrawing: false
                            })

                            res.status(200).json({
                                success: true,
                                count: withdrawCount,
                                checksum: checksumClient,
                                totalAmt: parseFloat(totalAmount).toFixed(2),
                                totalFee: parseFloat(totalFee).toFixed(2),
                                totalDeducted: parseFloat(Number(totalAmount) + Number(totalFee)).toFixed(2),
                                newBalance: newBal,
                                message: "Bulk withdrawal confirmed, scheduling withdrawals."
                            })

                        }).catch(function(err) {

                            console.log("-E-", err);
                            //Done scheduling all withdrawals or break, release withdrawals lock.
                            user.update({
                                isWithdrawing: false
                            })

                            res.status(500).json({
                                success: false,
                                message: "Bulk withdrawal failed. Please try again later."
                            })
                        })

                        return
                    } //end of else
                })
        }, //end of bulkWithdrawUSDT

        send2FA: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            var result = email2FA(user)
            if (result.error) {
                res.status(400).json({
                    success: false,
                    message: "Failed to send 2FA code to email, please try again later."
                })
                return
            } else {
                res.status(200).json({
                    success: true,
                    message: "2FA code successfully sent to " + user.email
                })
            }
            return
        }, //end of send2FA

        sendVerification: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            var result = sendVeriLink(user)
            if (result.error) {
                res.status(400).json({
                    success: false,
                    message: "Failed to send verification email, please try again later."
                })
                return
            } else {
                res.status(200).json({
                    success: true,
                    message: "Verification email successfully sent to " + user.email
                })
            }
            return
        }, //end of sendVerification

        getWithdrawals: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            let params = (req.query.hasOwnProperty("params")) ? JSON.parse(req.query.params) : {};

            let withdrawParams = {
                merchantId: user.merchantId,
                node: params.node || null,
                token: params.token || null
            }

            var withdrawals = await fetchUSDTWithdrawals(withdrawParams)
            if (withdrawals.error) {
                res.status(400).json({
                    success: false,
                    message: "Failed to fetch withdrawal history, please try again later."
                })
                return
            }
            res.status(200).json({
                success: true,
                merchantId: user.merchantId,
                transactions: withdrawals.transactions
            })
            return
        }, //end of getWithdrawals

        verifyUser: async function(req, res) {
            var url = new URL(lib.CONFIG.DOMAIN + req.url) || null
            var code = url.searchParams.get("v") || null
            var vericode = [] //declare empty array
            if (!code) {
                res.status(400).json({
                    success: false,
                    message: "Something went wrong."
                })
                return
            }

            vericode = code.split("-")
            if (vericode[1]) {
                var email = vericode[1]
                    //find user and verify code.
                await SQL.users.findOne({
                        where: {
                            email: email
                        }
                    })
                    .then((user) => {
                        if (!user) {
                            res.status(400).json({
                                success: false,
                                message: "Verification link has expired or is invalid."
                            })
                            return
                        } else {
                            //console.log(user.vericode, code)
                            if (user.vericode == code) {
                                //Success!
                                user.update({
                                    vericode: null,
                                    vericodeEpoch: null
                                })
                                res.writeHead(301, {
                                    Location: lib.CONFIG.MAIN + lib.CONFIG.STATUS_DIR + 'success'
                                })
                                res.end()

                                //Update DB
                                user.update({
                                    isVerified: true,
                                    vericode: null,
                                    vericodeEpoch: null
                                })
                            } else if (user.isVerified) {
                                //Account already verified
                                res.writeHead(301, {
                                    Location: lib.CONFIG.MAIN + lib.CONFIG.STATUS_DIR + 'verified'
                                })
                                res.end()
                            } else {
                                //Verification link is invalid or had expired.
                                res.writeHead(301, {
                                    Location: lib.CONFIG.MAIN + lib.CONFIG.STATUS_DIR + 'failed'
                                })
                                res.end()
                                return
                            }
                        } //end of user verification
                    }) //end of then user verification.
            } else {
                //Verification link is invalid or had expired.
                res.writeHead(301, {
                    Location: lib.CONFIG.DOMAIN + lib.CONFIG.STATUS_DIR + 'failed'
                })
                res.end()
                return
            } //end of else vericode
        }, //end of verifyUser

        genAPIKeys: async function(req, res) {
            var label = req.body.label || null
            var code2fa = req.body.code2fa || null
                //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined || label == null || code2fa == null) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            if (!await utility.validate2fa(user.merchantId, code2fa)) {
                res.status(400).json({
                    success: false,
                    message: "2FA is invalid, please make sure you had entered the correct value."
                })
                return
            }

            var apiKey = lib.randomize('Aa0', 48)
            var secret = lib.randomize('Aa0', 48)

            //check if user is already verified
            if (user.isVerified) {
                await SQL.api_keys.findOne({
                        where: {
                            label: label,
                            merchantId: user.merchantId
                        }
                    }).then(async(key) => {
                        //console.log(key)
                        if (!key || key == undefined || key == null) {
                            await SQL.api_keys.create({
                                merchantId: user.merchantId,
                                label: label,
                                apiKey: apiKey,
                                secretKey: secret,
                                epoch: Math.floor(new Date() / 1000)
                            })

                            res.status(200).json({
                                success: true,
                                keys: {
                                    key: apiKey,
                                    secret: secret
                                },
                                message: "Successfully generated API keys."
                            })
                            return
                        } else {
                            res.status(400).json({
                                success: false,
                                message: "Label already exist."
                            })
                            return
                        }
                    }).catch((e) => {
                        log.error(e)
                        res.status(400).json({
                            success: false,
                            message: "Something went wrong, please try again later."
                        })
                        return
                    }) //end of catch
                return true
            } else {
                res.status(400).json({
                    success: false,
                    message: "Please verify merchant's email account first."
                })
                return
            }
        }, //end of genAPIKeys

        setIPN: async function(req, res) {
            var ipnUrl = req.body.url || null
                //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined || ipnUrl == null) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            //check if user is already verified
            if (!user.isVerified) {
                res.status(400).json({
                    success: false,
                    message: "Merchant email account verification required before setting IPN URL."
                })
                return
            } else {

                let oldIpn = user.ipn_url;

                //Merchant account is verified
                //proceed to set IPN
                user.update({
                    ipn_url: ipnUrl
                })
                res.status(200).json({
                    success: true,
                    message: "Successfully set Merchant's IPN."
                })

                SQL.user_activity_logs.create({
                    ual_merchantId: user.merchantId,
                    ual_category: 'UPDATE',
                    ual_message: `Updated IPN URL from ${oldIpn} to ${ipnUrl}`,
                    ual_rowId: user.merchantId,
                    ual_table: 'users',
                    ual_oldVal: oldIpn,
                    ual_newVal: ipnUrl
                });

                return
            }
        }, // end of setIPN

        toggleIPNHandle: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            SQL.db.query("UPDATE users SET ipn_handle = ? WHERE merchantId = ?", {
                replacements: [!user.ipn_handle, user.merchantId],
                type: SQL.db.QueryTypes.UPDATE
            }).catch(function(error) {
                console.log(error);
                res.status(400).json({
                    success: false,
                    message: "Unable to update IPN Handle. Please try again later."
                })
                return
            });

            res.status(200).json({
                success: true,
                isIPNHandle: !user.ipn_handle,
                message: "IPN Handle: " + !user.ipn_handle
            })
            return

        }, //end of toggleIPNHandle

        setAPIKeyStatus: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            var label = req.body.label || null
            var isActive = req.body.isActive

            //WA for khookoay since his ajax calls are not able to send in content-type json.
            if (isActive == "false") {
                isActive = false
            } else if (isActive == "true") {
                isActive = true
            } else {
                //do nothing
            }
            //console.log(isActive, typeof isActive)
            if ((user == undefined) || (label == null) || (typeof isActive !== "boolean")) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            await SQL.api_keys.findOne({
                    where: {
                        merchantId: user.merchantId,
                        label: label
                    }
                }).then((keyPair) => {
                    if (keyPair == undefined) {
                        res.status(400).json({
                            success: false,
                            message: "Unable to find keypair."
                        })
                        return
                    }
                    //update new status (activate or deactivate)
                    keyPair.update({
                        isActive: isActive
                    })

                    res.status(200).json({
                        success: true,
                        keyPair: {
                            key: keyPair.apiKey,
                            //secret: keyPair.secretKey,
                            isActive: keyPair.isActive
                        },
                        message: "Actions saved."
                    })
                    return
                }).catch((e) => {
                    log.error(e)
                    res.status(400).json({
                        success: false,
                        message: "Something went wrong, please try again later."
                    })
                    return
                }) //end of catch
        }, //end of setAPIKeyStatus

        changePassword: async function(req, res) {
            const user = await this.getUser(req)
            var password = req.body.password || null
            var newPassword = req.body.newPassword || null

            if (user == undefined || !password || !newPassword) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            

            //check if old password matches
            await lib.bcrypt.compare(password, user.password, async function(err, result) {
                if (!result) {
                    res.status(400).json({
                        success: false,
                        message: "Incorrect current password entered."
                    })
                    return
                }

                //change to new Password
                var changeResult = changePassword(user, newPassword)
                if (!changeResult.error) {
                    res.status(200).json({
                        success: true,
                        message: "Account password successfully changed."
                    })
                    return
                } else {
                    res.status(400).json({
                        success: false,
                        message: "Unable to reset password, please try again later."
                    })
                    return
                }
            })
        }, //end of changePassword

        resetNewPassword: async function(req, res) {
            var hash = req.body.hash || null
            var password = req.body.password || null

            if (hash && password) {
                //get user obj
                await SQL.users.findOne({
                    where: {
                        vericode: hash
                    }
                }).then(async(userObj) => {
                    if (userObj) {
                        

                        var result = changePassword(userObj, password)
                        if (!result.error) {
                            //Clear vericode hash
                            userObj.update({
                                vericode: null,
                                vericodeEpoch: null
                            })
                            res.status(200).json({
                                success: true,
                                message: "Successfully updated merchant account password."
                            })
                            return
                        }
                    }
                    res.status(400).json({
                        success: false,
                        message: "Unable to reset password, please try again later."
                    })
                    return
                })
            } else {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }
        }, //end of resetNewPassword

        updateUserInfo: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)

            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }


            

            let name = req.body.name || user.name;
            let orgName = req.body.orgName || user.orgName;
            let country = req.body.country || user.country;
            let mobileNum = req.body.mobileNum || user.mobileNum;
            let idNum = req.body.idNum || user.idNum;
            let businessRegNum = req.body.businessRegNum || user.businessRegNum;
            let businessNature = req.body.businessNature || user.businessNature;
            let address = req.body.address || user.address;
            let city = req.body.city || user.city;
            let state = req.body.state || user.state;
            let postcode = req.body.postcode || user.postcode;

            let updateObj = {
                name: name,
                orgName: orgName,
                country: country,
                mobileNum: mobileNum,
                idNum: idNum,
                businessRegNum: businessRegNum,
                businessNature: businessNature,
                address: address,
                city: city,
                state: state,
                postcode: postcode
            }

            let oldValJson = JSON.stringify({
                name: user.name,
                orgName: user.orgName,
                country: user.country,
                mobileNum: user.mobileNum,
                idNum: user.idNum,
                businessRegNum: user.businessRegNum,
                businessNature: user.businessNature,
                address: user.address,
                city: user.city,
                state: user.state,
                postcode: user.postcode
            });

            let currEpoch = Math.floor(new Date() / 1000);

            user.update(updateObj).then(() => {
                    res.status(200).json({
                        success: true,
                        info: updateObj,
                        message: "Merchant profile successfully updated."
                    })

                    SQL.user_activity_logs.create({
                        ual_merchantId: user.merchantId,
                        ual_category: 'UPDATE',
                        ual_message: `Updated user info`,
                        ual_rowId: user.merchantId,
                        ual_table: 'users',
                        ual_oldVal: oldValJson,
                        ual_newVal: JSON.stringify(updateObj)
                    });

                    return;

                }).catch((e) => {
                    log.error(e)
                    res.status(400).json({
                        success: false,
                        message: "Something went wrong, please try again later."
                    })
                    return
                }) //end of catch
        }, //end of updateUserInfo

        sendSampleIPN: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            var ipn_url = user.ipn_url || null
            var merchantId = user.merchantId

            if (ipn_url == null) {
                res.status(400).json({
                    success: false,
                    message: "Please sepcify a valid IPN callback url and click save."
                })
                return
            }

            var headers = {
                "Content-Type": "application/x-www-form-urlencoded"
            }
            var sampleIPN = {
                orderId: "SAMPLE123",
                merchantId: merchantId,
                paymentAddr: "0x0000000000000000000000000000000000000000",
                transactionAmt: "100.00000000",
                currentReceived: "20.00000000",
                totalReceived: "70.00"
            }

            let result = false;
            for (let i = 1; i <= 5; i++) {

                await lib.requestpn({
                    url: `${ipn_url}`,
                    method: "POST",
                    headers: headers,
                    form: sampleIPN
                }).then(function(response) {

                    res.status(200).json({
                        success: true,
                        message: "Completed send Sample IPN with SUCCESSFUL response"
                    });
                    result = true;
                    return;

                }).catch(e => {
                    log.error("E191: " + e);

                    if (e.error != undefined) {
                        res.status(400).json({
                            success: false,
                            errStatusCode: e.statusCode,
                            message: e.error
                        });
                        result = true;
                        return;
                    }
                })

                if (result) return;

                await delay(5000);
            }


            res.status(400).json({
                success: false,
                message: "Unable to send sample IPN, please try again later."
            })
            return
        }, //end of sendSampleIPN

        toggleForcePush: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            SQL.db.query("UPDATE users SET forceTx = ? WHERE merchantId = ?", {
                replacements: [!user.forceTx, user.merchantId],
                type: SQL.db.QueryTypes.UPDATE
            }).catch(function(error) {
                console.log(error);
                res.status(400).json({
                    success: false,
                    message: "Unable to update Force Push Status. Please try again later."
                })
                return
            });

            res.status(200).json({
                success: true,
                isForcePush: !user.forceTx,
                message: "Transaction Force Push status is: " + !user.forceTx
            })
            return

        }, //end of toggleForcePush

        manualPostIpnMerchant: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            var ipnId = req.body.ipnId || null

            if (!ipnId) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            try {
                let transaction = await SQL.db.query(`
                    SELECT * from usdt_tx_batches join ipn_history on orderId = ipn_orderId where ipn_id = ? and merchantId = ?`, {
                    replacements: [ipnId, user.merchantId],
                    type: SQL.db.QueryTypes.SELECT
                });

                if (transaction.length < 1) {
                    res.status(400).json({
                        success: false,
                        message: "IPN ID '" + ipnId + "' does not exist"
                    })
                    return;
                }

                transaction = transaction[0];

                for (let i = 1; i <= 5; i++) {
                    let result = await ipn_post(transaction, transaction.ipn_currentReceived, transaction.ipn_totalReceived);
                    if (result === true) {
                        res.status(200).json({
                            success: true,
                            ipn_success: true,
                            message: "Completed resend IPN with SUCCESSFUL response"
                        })
                        return;
                    }
                    await delay(5000);
                }

                res.status(200).json({
                    success: true,
                    ipn_success: false,
                    message: "Completed resend IPN with UNSUCCESSFUL response or NO response"
                })

                SQL.user_activity_logs.create({
                    ual_merchantId: user.merchantId,
                    ual_category: 'LOG',
                    ual_message: `Resend IPN for Order ID: ${transaction.orderId}`,
                    ual_newVal: JSON.stringify(transaction)
                });

                return

            } catch (e) {
                console.log(e);
                res.status(400).json({
                    success: false,
                    message: "Failed to retrieve payment address of Order ID: " + transaction.orderId
                })
            }

        }, //end of manualPostIpnMerchant

        getIpnHistory: async function(req, res) {

            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            await fetchIpnHistory(user.merchantId)
                .then(results => {
                    res.status(200).json({
                        success: true,
                        data: results
                    });
                })
                .catch(error => {
                    res.status(400).json({
                        success: false,
                        message: "Something went wrong, please try again later."
                    })
                    return error;
                });

        }, //end of getIpnHistory

        genOtpSecret: async function(req, res) {

            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            let secret = await lib.otp.authenticator.generateSecret();
            let encryptedSecret = await utility.aesEncrypt(secret);

            await SQL.db.query(`
                UPDATE users 
                set otp_temp_secret = ?
                where merchantId = ?`, {
                replacements: [encryptedSecret, user.merchantId],
                type: SQL.db.QueryTypes.UPDATE
            }).then(async() => {

                let url = await lib.otp.authenticator.keyuri(lib.CONFIG.BRAND_NAME, lib.CONFIG.BRAND_NAME, secret);
                let qrcodeImg = await lib.qrcode.toDataURL(url);
                if (qrcodeImg.err) {
                    console.log("-E- ", qrcodeImg.err)
                    return qrcodeImg.err;
                }

                await lib.nodemailer.createTestAccount(async(err, account) => {
                    let transporter = lib.nodemailer.createTransport({
                        host: lib.CONFIG.EMAIL_VERILINK.HOST,
                        port: lib.CONFIG.EMAIL_VERILINK.PORT,
                        secure: true, // upgrade later with STARTTLS
                        auth: {
                            user: lib.CONFIG.EMAIL_VERILINK.ADDRESS,
                            pass: lib.CONFIG.EMAIL_VERILINK.PASSWORD
                        },
                        tls: {
                            rejectUnauthorized: false
                        }
                    })

                    if (err) {
                        log.error("Something went wrong with sendVeriLink, please try again later.")
                        res.status(400).json({
                            success: false,
                            message: "Something went wrong with sendVeriLink, please try again later."
                        });
                        return err;
                    }

                    lib.juice.juiceFile(__dirname + '/../templates/OTP_request.html', null, async(err, html) => {
                        if (err) {
                            console.log(err);
                            res.status(400).json({
                                success: false,
                                message: "Failed to generate email, please try again later."
                            });
                            return err;
                        } else {

                            //set mail options
                            let mailOptions = {
                                from: lib.CONFIG.EMAIL_VERILINK.FROM,
                                to: user.email,
                                subject: "Mobile 2FA Secret",
                                html: html,
                                attachments: [{
                                    path: qrcodeImg,
                                    cid: 'qrcode'
                                }]
                            }

                            await transporter.sendMail(mailOptions, async function(error, info) {
                                    if (error) {
                                        console.log("-E- ", error);
                                        res.status(400).json({
                                            success: false,
                                            message: "Failed to send email, please try again later."
                                        });
                                        return error;
                                    } else {
                                        res.status(200).json({
                                            success: true,
                                            message: "QR Code has been sent to your email"
                                        });
                                    }
                                }) //end of await transporter.sendMail

                        }
                    });
                });

            }).catch(function(e) {
                console.log(e);
                res.status(400).json({
                    success: false,
                    message: "Something went wrong, please try again later."
                });
            });

        }, //end of genOtpSecret

        setup2fa: async function(req, res, type) {

            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            let code2fa = req.body.code2fa || null;
            let secret = (type == 'FIRST') ? user.otp_temp_secret || null : user.otp_secret || null;

            if (!code2fa || !secret) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                });
                return;
            }
            let decryptedSecret = await utility.aesDecrypt(secret);
            let result = await lib.otp.authenticator.check(code2fa, decryptedSecret);

            if (!result) {
                res.status(400).json({
                    success: false,
                    message: "Unsuccessful 2FA Code verification"
                });
                return;
            }

            if (type == 'FIRST') {

                try {
                    await user.update({
                        otp_secret: secret,
                        otp_temp_secret: null
                    });

                    res.status(200).json({
                        success: true,
                        message: "Successfully verified 2FA Code"
                    });

                } catch (e) {
                    console.log(e);
                    res.status(400).json({
                        success: false,
                        message: "Unable to update OTP key please try again later"
                    });
                }

            } else if (type == 'DELETE') {

                try {

                    await user.update({
                        otp_secret: null
                    });

                    res.status(200).json({
                        success: true,
                        message: "Successfully deleted OTP key"
                    });

                } catch (e) {
                    console.log(e);
                    res.status(400).json({
                        success: false,
                        message: "Unable to delete OTP key please try again later"
                    });
                }

            }

        }, //end of setup2fa

        genDepositAddr: async function(req, res) {

            try {

                //*****We will always need to verify and get user details thru this for ALL private endpoints****
                const user = await this.getUser(req)
                if (user == undefined) {
                    res.status(400).json({
                        success: false,
                        message: "Incorrect or missing parameters, please refer to API doc."
                    })
                    return
                }

                let code2fa = req.body.code2fa || null;
                let label = req.body.label || null;
                let node = req.body.node || null;
                let token = req.body.token || null;

                if (!code2fa || !label || !node || !token) {
                    res.status(400).json({
                        success: false,
                        message: "Incorrect or missing parameters, please refer to API doc."
                    });
                    return;
                }

                //check if 2fa code is valid
                if (!await utility.validate2fa(user.merchantId, code2fa)) {
                    res.status(400).json({
                        success: false,
                        message: "Invalid 2FA code."
                    })
                    return
                }

                let nodeToken = node + '_' + token;

                let params = {
                    coinType: nodeToken
                }

                let depAddr = await lib.walletObj.createAcc(params);

                await SQL.merch_deposit_addrs.create({
                    mda_merchantId: user.merchantId,
                    mda_label: label,
                    mda_node: node,
                    mda_token: token,
                    mda_depositAddr: depAddr.address
                });

                res.status(200).json({
                    success: true,
                    depAddr: depAddr.address,
                    message: "Successfully generated new deposit address."
                })

            } catch (err) {
                console.log(err);
                res.status(400).json({
                    success: false,
                    message: "Something went wrong please try again later."
                })
            }

        }, //end of genDepositAddr

        getDepositAddrs: async function(req, res) {

            try {

                //*****We will always need to verify and get user details thru this for ALL private endpoints****
                const user = await this.getUser(req)
                if (user == undefined) {
                    res.status(400).json({
                        success: false,
                        message: "Incorrect or missing parameters, please refer to API doc."
                    })
                    return
                }

                let results = await SQL.merch_deposit_addrs.findAll({
                    where: {
                        mda_merchantId: user.merchantId
                    },
                    order: [
                        ['mda_createdAt', 'DESC']
                    ]
                });

                if (results.length == 0) {
                    res.status(400).json({
                        success: false,
                        message: "No deposit addresses found."
                    });
                    return;
                }

                let depositAddrs = {};

                for (let row of results) {

                    if (depositAddrs[row.mda_node] == undefined) {
                        depositAddrs[row.mda_node] = {};
                    }

                    if (depositAddrs[row.mda_node][row.mda_token] == undefined) {
                        depositAddrs[row.mda_node][row.mda_token] = [];
                    }

                    let receivedAmount = await SQL.db.query(`
                        select ifnull( sum( ifnull(ucd_amount, 0) ), 0 ) total
                        from usdt_clear_deposits 
                        where ucd_merchantId = :merchantId
                            and ucd_depositAddr = :depositAddr
                    `, {
                        replacements: {
                            merchantId: user.merchantId,
                            depositAddr: row.mda_depositAddr
                        },
                        type: SQL.db.QueryTypes.SELECT
                    });

                    depositAddrs[row.mda_node][row.mda_token].push({
                        node: row.mda_node,
                        token: row.mda_token,
                        label: row.mda_label,
                        depositAddr: row.mda_depositAddr,
                        receivedAmount: Number(receivedAmount[0].total).toFixed(2),
                        createdAt: row.mda_createdAt,
                        latestTx: row.mda_updatedAt
                    });
                }

                res.status(200).json({
                    success: true,
                    depAddr: depositAddrs,
                    message: "Successfully retrieved deposit addresses."
                });


            } catch (e) {
                console.log(e);
                res.status(400).json({
                    success: false,
                    message: "Something went wrong please try again later."
                })
            }

        }, //end of getDepositAddr

        getDeposits: async function(req, res) {

            try {

                //*****We will always need to verify and get user details thru this for ALL private endpoints****
                const user = await this.getUser(req)
                if (user == undefined) {
                    res.status(400).json({
                        success: false,
                        message: "Incorrect or missing parameters, please refer to API doc."
                    });
                    return;
                }

                var merchantId = user.merchantId || null

                if (!merchantId) {
                    res.status(400).json({
                        success: false,
                        message: "Incorrect or missing parameters, please refer to API doc."
                    });
                    return;
                }

                let results = await SQL.usdt_clear_deposits.findAll({
                    where: {
                        ucd_merchantId: user.merchantId
                    }
                });

                let deposits = [];

                for (let row of results) {

                    deposits.push({
                        merchantId: row.ucd_merchantId,
                        createdEpoch: row.ucd_createdEpoch,
                        confirmedEpoch: row.ucd_confirmedEpoch,
                        node: row.ucd_node,
                        token: row.ucd_token,
                        depositId: row.ucd_depositId,
                        amount: row.ucd_amount,
                        depositFee: row.ucd_depositFee,
                        depositAddr: row.ucd_depositAddr,
                        status: row.ucd_status,
                        txid: row.ucd_txid,
                        sendFeeUsd: row.ucd_sendFeeUsd
                    });
                }

                res.status(200).json({
                    success: true,
                    deposits: deposits
                });

                return;

            } catch (e) {
                console.log(e);
                res.status(400).json({
                    success: false,
                    message: "Something went wrong please try again later"
                });
                return;
            }

        }, //end of getDeposits

        getOrderChartData: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return;
            }

            var merchantId = user.merchantId || null;
            var month = req.body.month || null;

            if (!merchantId || merchantId == null) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return;
            }

            let sqlDate = null;

            if (month != null) {
                let date = new Date();
                sqlDate = date.getFullYear() + '-' + month + '-01';
            }

            try {

                let dates = [];
                let orderAmounts = [];
                let clearedAmounts = [];

                let results = await SQL.db.query(`
                    select 
                        date_format(dates, '%d') dates, 
                        round( sum( ifnull( usdt_tx_batches.amount, 0 ) ), 2 ) orderAmt, 
                        round( sum( ifnull( usdt_clear_batches.amount, 0 ) ), 2 ) clearedAmt 
                    from (
                        select * from
                        (select adddate('1970-01-01',t4*10000 + t3*1000 + t2*100 + t1*10 + t0) dates from
                        (select 0 t0 union select 1 union select 2 union select 3 union select 4 union select 5 union select 6 union select 7 union select 8 union select 9) t0,
                        (select 0 t1 union select 1 union select 2 union select 3 union select 4 union select 5 union select 6 union select 7 union select 8 union select 9) t1,
                        (select 0 t2 union select 1 union select 2 union select 3 union select 4 union select 5 union select 6 union select 7 union select 8 union select 9) t2,
                        (select 0 t3 union select 1 union select 2 union select 3 union select 4 union select 5 union select 6 union select 7 union select 8 union select 9) t3,
                        (select 0 t4 union select 1 union select 2 union select 3 union select 4 union select 5 union select 6 union select 7 union select 8 union select 9) t4) v
                        where dates 
                        between 
                            STR_TO_DATE( ?, '%Y-%M-%d' )
                        and 
                            last_day( ifnull( STR_TO_DATE( ?, '%Y-%M-%d'), current_date) )
                    ) dates
                    left join usdt_tx_batches on date(usdt_tx_batches.createdAt) = dates and usdt_tx_batches.merchantId = ?
                    left join usdt_clear_batches on date(usdt_clear_batches.createdAt) = dates and usdt_clear_batches.merchantId = ?
                    group by dates
                    order by dates
                `, {
                    replacements: [sqlDate, sqlDate, merchantId, merchantId],
                    type: SQL.db.QueryTypes.SELECT
                });

                // console.log(results);

                results.forEach(row => {
                    dates.push(row.dates);
                    orderAmounts.push(row.orderAmt || 0);
                    clearedAmounts.push(row.clearedAmt || 0);
                });

                res.status(200).json({
                    success: true,
                    dates: dates,
                    orderAmounts: orderAmounts,
                    clearedAmounts: clearedAmounts
                });

                return;
            } catch (e) {
                console.log(e);
                res.status(400).json({
                    success: false,
                    message: "Something went wrong please try again later"
                });
                return;
            }

        }, //end of getOrderChartData

        getResellerMerchants: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                });
                return;
            }

            if (!user.isReseller) {
                res.status(403).json({
                    success: false,
                    message: "You do not have reseller privileges to this endpoint."
                })
                return
            }

            var merchantId = user.merchantId;

            try {
                // Get Reseller merchants, reseller markup and total fees collected per merchant

                let resellerMerchantData = await SQL.db.query(`
                    select 
                        orgName, 
                        reseller_fee * 100 as resellerFee, 
                        ifnull( sum( amount * ifnull(resellerFee, 0) ), 0 ) totalFeesCollected
                    from users 
                    left join withdrawals on users.merchantId = withdrawals.merchantId and status != 'INVALID'
                    where parentReseller = ?
                    group by orgName, reseller_fee`, {
                    replacements: [user.merchantId],
                    type: SQL.db.QueryTypes.SELECT
                });

                res.status(200).json({
                    success: true,
                    deposits: deposits
                });
                return;
            } catch (e) {
                console.log(e);
                res.status(400).json({
                    success: false,
                    message: "Something went wrong please try again later"
                });
                return;
            }

        }, //end of getResellerMerchants

        getSupportedTokens: async function(req, res) {

            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            let results = await SQL.supportedTokens.findAll();

            let supportedTokens = [];

            for (let rowData of results) {
                supportedTokens.push({
                    node: rowData.st_node,
                    token: rowData.st_token,
                    active: rowData.st_active
                })
            }

            res.status(200).json({
                success: true,
                supportedTokens: supportedTokens
            });
            return;
        }, //end of getSupportedTokens

        getWhitelistedIps: async function(req, res) {

            try {

                //*****We will always need to verify and get user details thru this for ALL private endpoints****
                const user = await this.getUser(req)
                if (user == undefined) {
                    res.status(400).json({
                        success: false,
                        message: "Incorrect or missing parameters, please refer to API doc."
                    })
                    return
                }

                let results = await SQL.whitelisted_ips.findAll({
                    where: {
                        wip_merchantId: user.merchantId
                    }
                });

                let whitelistedIps = [];

                for (let rowData of results) {
                    whitelistedIps.push({
                        merchantId: rowData.wip_merchantId,
                        apiKey: rowData.wip_apiKey,
                        ip: rowData.wip_ip,
                        lastAccess: rowData.wip_lastAccess,
                        createdAt: rowData.wip_createdAt
                    })
                }

                res.status(200).json({
                    success: true,
                    whitelistedIps: whitelistedIps
                });
                return;

            } catch (err) {
                console.log(err);
                res.status(400).json({
                    success: false,
                    message: "Something went wrong please try again."
                })
                return
            }

        }, //end of getWhitelistedIps

        createWhitelistIp: async function(req, res) {

            try {
                //*****We will always need to verify and get user details thru this for ALL private endpoints****
                const user = await this.getUser(req)
                if (user == undefined) {
                    res.status(400).json({
                        success: false,
                        message: "Incorrect or missing parameters, please refer to API doc."
                    })
                    return
                }

                let apiKey = req.body.apiKey;
                let ip = req.body.ip;

                if (!apiKey || !ip) {
                    res.status(400).json({
                        success: false,
                        message: "Incorrect or missing parameters, please refer to API doc."
                    })
                    return
                }

                await SQL.whitelisted_ips.create({
                    wip_merchantId: user.merchantId,
                    wip_apiKey: apiKey,
                    wip_ip: ip
                });

                res.status(200).json({
                    success: true,
                    message: "Successfully registered new whitelisted IP."
                });

                return

            } catch (err) {
                console.log(err);
                res.status(400).json({
                    success: false,
                    message: "Something went wrong please try again."
                })
                return
            }

        }, //end of createWhitelistIp

        kycUpload: async function(req, res) {
            //*****We will always need to verify and get user details thru this for ALL private endpoints****
            const user = await this.getUser(req)
            if (user == undefined || !req.files) {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            if (user.kycStatus != null) {
                res.status(406).json({
                    success: false,
                    message: "KYC process has already been initiated."
                })
                return
            }

            let idFront = req.files.idFront;
            let idBack = req.files.idBack;
            let portrait = req.files.portrait;

            if (!idFront || idFront.mimetype.substring(0, 6) != 'image/' || !idBack || idBack.mimetype.substring(0, 6) != 'image/' || !portrait || portrait.mimetype.substring(0, 6) != 'image/') {
                res.status(400).json({
                    success: false,
                    message: "Incorrect or missing parameters, please refer to API doc."
                })
                return
            }

            try {

                let filePath = 'KYC/' + user.merchantId + '/';

                await aws.uploadToS3(filePath, 'idFront.' + idFront.name.split('.').pop(), idFront.data, idFront.mimetype);
                await aws.uploadToS3(filePath, 'idBack.' + idBack.name.split('.').pop(), idBack.data, idBack.mimetype);
                await aws.uploadToS3(filePath, 'portraitPhoto.' + portrait.name.split('.').pop(), portrait.data, portrait.mimetype);

                await user.update({
                    kycStatus: 'PENDING'
                });

                res.status(200).json({
                    success: true,
                    message: "Successfully uploaded KYC data."
                });
                return
            } catch (err) {
                console.log(err);
                res.status(400).json({
                    success: false,
                    message: "Something went wrong please try again."
                })
                return
            }

        }, //end of kycUpload

        //Exporting this func, need to use it in usdt_pg.js
        fetchWithdrawBal: async function(merchantId) {
            return await fetchWithdrawBal(merchantId)
        }, //end of fetchWithdrawBal

        sendVeriLink: async function(userObj) {
            return await sendVeriLink(userObj)
        }, //end of sendVeriLink

        getMarkedUpFee: async function(nodeToken) {
            return await markupEstimateFeeUsd(nodeToken);
        }, //end of getMarkedUpFee

        getLatestOrders,
        fetchOrderCount,
        ipn_post,
        nextWithdrawBal,

    } //end of module.exports