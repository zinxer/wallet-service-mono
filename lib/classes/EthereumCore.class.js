const lib = require("../lib.js");
const Web3 = require('web3')
const SQL = lib.SQL

/*
 * Parent class for Ethereum based transactions
 * Main class containing functions for manipulating and getting information on ETH in the Ethereum Blockchain 
 * Contains general functions that can be used by all child classes
 */

class EthereumCore {

    constructor() {

        this.auto_send = true; //Switch to false to prevent send transaction

        this.coreType = 'ETH';
        this.tokenType = 'ETH';

        const rpcURL = lib.CONFIG.ETH_NODE.NETWORK;

        const OPTIONS = {
            defaultBlock: "latest",
            transactionConfirmationBlocks: 1,
            transactionBlockTimeout: 5
        }

        this.client = new Web3(rpcURL, null, OPTIONS);

        this.walletPassword = lib.CONFIG.ETH_WALLET_PASSWORD;

        this.unitMapping = {
            "0": "noether",
            "1": "wei",
            "3": "kwei",
            "6": "mwei",
            "9": "gwei",
            "12": "microether",
            "15": "milliether",
            "18": "ether",
            "21": "kether",
            "24": "mether",
            "27": "tether",
        };
    }

    delay(t, val) {
        return new Promise(function(resolve) {
            setTimeout(function() {
                resolve(val);
            }, t);
        });
    }

    async getEthPrice(convert = 'USD') {

        try {

            let apiKey = lib.CONFIG.ETHERSCAN.APIKEY;
            let apiUrl = `https://api.etherscan.io/api?module=stats&action=ethprice&apikey=` + apiKey;

            let options = {
                uri: apiUrl,
                headers: {
                    "Content-type": "application/json",
                    "Accept": "application/json",
                    "Accept-Charset": "utf-8"
                },
                json: true // Automatically parses the JSON string in the response
            };

            let result = await lib.requestpn(options);

            let response = {
                USD: result.result.ethusd
            }

            response = response[convert];

            return response;

        } catch (err) {
            throw err;
        }

    }

    async getMedianGasPrice(params) {

        try {
            // The gas price is determined by the last few blocks median gas price. GasPrice is the wei per unit of gas
            let medianGasPrice = await this.client.eth.getGasPrice();
            //Increase gasprice by 50%
            medianGasPrice = (Math.trunc(Number(medianGasPrice) * 1.2)).toString()

            return medianGasPrice;
        } catch (err) {
            throw err;
        }
    }

    async getConfirmations(params) {

        try {

            let txid = params.txid || null;
            let blockNumber = params.blockNumber || null;

            if (blockNumber == null) {
                // Get transaction details
                const tx = await this.client.eth.getTransaction(txid);
                blockNumber = tx.blockNumber;
            }

            // Get current block number
            let currentBlock = await this.client.eth.getBlockNumber();

            // When transaction is unconfirmed, its block number is null.
            // In this case we return 0 as number of confirmations
            return blockNumber === null ? 0 : currentBlock - blockNumber
        } catch (err) {
            throw err;
        }
    }

    // Get all addresses in wallet
    async getWalletAddresses() {
        try {

            //only get addresses under 48 hours
            let currentEpoch = Math.floor(new Date() / 1000);
            let epochRange = currentEpoch - 172800 //172800 = 48 hours
            let result = await SQL.ethereum_keys.findAll({
                where: {
                    ek_createdEpoch: {
                        [lib.Op.gt]: epochRange
                    }
                },
                attributes: [
                    ['ek_address', 'paymentAddr']
                ],
                raw: true
            });

            return result;

        } catch (err) {
            throw err;
        }

    }

    // Validate address if is a valid Ethereum address
    async validateAddr(params) {
        try {

            let address = params.address;

            let valid = this.client.utils.isAddress(address);

            return valid;

        } catch (err) {
            throw err;
        }
    }

    // Check if address exists in wallet
    async isAddressInWallet(params) {
        try {

            let address = params.address;
            let transaction = params.transaction || null;

            let result = null;

            if (transaction) {
                result = await SQL.ethereum_keys.findOne({
                    where: {
                        ek_address: address
                    },
                    transaction: transaction
                });
            } else {
                result = await SQL.ethereum_keys.findOne({
                    where: {
                        ek_address: address
                    }
                });
            }

            if (result != null) {
                return true;
            } else {
                return false;
            }
        } catch (err) {
            throw err;
        }

    }

    async estimateEtherCost(params) {
        try {
            // console.log('estimateEtherCost_' + this.coreType + '_' + this.tokenType);

            let sender = params.sender;
            let recipient = params.recipient;
            let amount = params.amount;

            // If amount is number convert to string
            if (!isNaN(amount)) {
                amount = amount.toString();
            }

            // Convert amount to Wei
            let weiAmount = this.client.utils.toWei(amount, 'ether');

            // The gas price is determined by the last few blocks median gas price. GasPrice is the wei per unit of gas
            let medianGasPrice = await this.client.eth.getGasPrice();
            //Increase gasprice by 50%
            medianGasPrice = (Math.trunc(Number(medianGasPrice) * 1.2)).toString()

            // Determine the nonce
            let count = await this.client.eth.getTransactionCount(sender);

            let txObj = {
                nonce: this.client.utils.toHex(count),
                from: sender,
                to: recipient,
                value: this.client.utils.toHex(weiAmount),
                gasPrice: this.client.utils.toHex(medianGasPrice)
            };

            let gasEstimate = await this.client.eth.estimateGas(txObj) * 1;
            gasEstimate = Math.ceil(gasEstimate);

            let totalWeiCost = this.client.utils.toBN(gasEstimate * medianGasPrice);

            let etherCost = this.client.utils.fromWei(totalWeiCost, 'ether');

            return etherCost;
        } catch (err) {
            throw err;
        }
    }

    async estimateFee(params) {
        try {
            // console.log('estimateFee_' + this.coreType + '_' + this.tokenType);

            let etherCost = await this.estimateEtherCost(params);

            let ethFee = etherCost * (await this.getEthPrice('USD'));

            return ethFee;
        } catch (err) {
            throw err;
        }
    }

    async dumpPrivateKey(params) {
        try {
            console.log('dumpPrivateKey_' + this.coreType + '_' + this.tokenType);

            let address = params.address;

            let result = await SQL.ethereum_keys.findOne({
                where: {
                    ek_address: address
                }
            });

            let password = this.walletPassword;

            let account = this.client.eth.accounts.decrypt(result.ek_keyJson, password);

            return account;
        } catch (err) {
            throw err;
        }
    }

    async importPrivateKey(params) {
        try {
            //console.log('importPrivateKey_' + this.coreType + '_' + this.tokenType);

            let privateKey = params.privateKey;
            let address = params.address;

            let password = this.walletPassword;

            let keyJson = this.client.eth.accounts.encrypt(privateKey, password);

            let currEpoch = Math.floor(new Date() / 1000);

            let _this = this;

            // Do not commit to DB if error occurs within transaction
            await SQL.db.transaction(async function(t) {

                let checksumAddress = _this.client.utils.toChecksumAddress(keyJson.address);

                await SQL.ethereum_keys.create({
                    ek_version: keyJson.version,
                    ek_id: keyJson.id,
                    ek_address: checksumAddress,
                    ek_keyJson: JSON.stringify(keyJson),
                    ek_createdEpoch: currEpoch
                }, {
                    transaction: t
                });

                let params = {
                    address: checksumAddress,
                    transaction: t
                }

                if (!await _this.isAddressInWallet(params)) {
                    throw new Error("Address not found in wallet!");
                }

                return Promise.resolve();
            });

        } catch (err) {
            throw err;
        }
    }

    //faster account generation
    async createAcc(params) {
        try {
            //console.log('createAcc_' + this.coreType + '_' + this.tokenType);

            //generate address details
            let account = await this.client.eth.accounts.create();

            let params = {
                address: account.address,
                privateKey: account.privateKey
            }

            await this.importPrivateKey(params);

            return {
                address: account.address,
                privateKey: account.privateKey
            };
        } catch (err) {
            throw err;
        }
    }


    async getTransaction(params) {
        try {
            // console.log('getTransaction_' + this.coreType + '_' + this.tokenType);

            let txid = params.txid;

            let result = null;

            // Transaction will not appear immediately. Try for certain amount of times until info is available.
            for (let i = 1; i <= 20; i++) {
                await this.delay(5000)
                result = await this.client.eth.getTransaction(txid);
                if (result != null) {
                    //console.log("Number of tries:" + i);
                    break;
                }
            }

            if (result == null) {
                throw new Error("Unable to get transaction info");
            }
            // console.log(result);
            result['receiveAddress'] = result.to;
            result['amount'] = this.client.utils.fromWei(result.value, 'ether');

            let confParams = {
                txid: txid,
                blockNumber: result.blockNumber
            }
            result['confirmations'] = await this.getConfirmations(confParams);

            let status = false;
            let gasUsed = null;

            if (result['confirmations'] > 0) {
                let txReceipt = await this.client.eth.getTransactionReceipt(txid);
                status = txReceipt.status;
                gasUsed = txReceipt.gasUsed;
            }

            result['gasUsed'] = gasUsed;

            result['valid'] = status;

            result['fee'] = null;

            if (gasUsed != null) {
                let gasPriceGwei = this.client.utils.fromWei(result.gasPrice, 'gwei');

                let feeWei = this.client.utils.fromWei((parseFloat(gasUsed) * parseFloat(gasPriceGwei)).toFixed(0), 'gwei');
                // let feeWei = this.client.utils.fromWei(this.client.utils.toBN(gasUsed).mul(this.client.utils.toBN(gasPriceGwei)), 'gwei');

                result['fee'] = feeWei;
            }

            return result;

        } catch (err) {
            throw err;
        }
    }

    //address needs to be from wallet.
    //Returns complete transactions for wallets that are generated and imported to wallet.dat since usage.
    async listTransactions(params) {
        try {
            console.log('listTransactions_' + this.coreType + '_' + this.tokenType);

            let address = params.address;

            //prep rpc command
            var batch = [{
                method: "omni_listtransactions",
                parameters: [address, 99999999, 0, 556128]
            }];

            var res = await client.command(batch);
            this.validate(res);

            //console.log(res)
            return res[0];
        } catch (err) {
            throw err;
        }
    }

    //List all accounts in wallet.dat
    async listAccounts(params) {
        try {
            console.log('listAccounts_' + this.coreType + '_' + this.tokenType);

            //prep rpc command
            var batch = [{
                method: "listaccounts",
                parameters: []
            }];

            var res = await client.command(batch);
            this.validate(res)

            //console.log(res[0])
            return res[0];
        } catch (err) {
            throw err;
        }

    }

    async getBalance(params) {
        try {
            // console.log('getBalance_' + this.coreType + '_' + this.tokenType);

            let address = params.address || null;

            if (address == null) {
                throw new Error("No address provided");
            }

            let result = null;

            if (Array.isArray(params.address)) {

                result = [];

                let batch = new this.client.BatchRequest();

                for (let address of params.address) {
                    batch.add(this.client.eth.getBalance.request(address, (err, res) => {
                        if (err) throw err
                    }));
                }

                let balances = await batch.execute();

                let cnt = 0;

                for (let address of params.address) {
                    let balance = this.client.utils.fromWei(balances.response[cnt], 'ether');

                    result[address] = balance;

                    cnt++;
                }
            } else {
                let weiBalance = await this.client.eth.getBalance(address);
                let balance = this.client.utils.fromWei(weiBalance, 'ether');

                result = balance;
            }


            //console.log(res[0])
            return result;
        } catch (err) {
            throw err;
        }

    }

    async getWalletBalances(params) {
        return [] // disabled checking ether balance for addresses since we are not expecting eth deposits atm.
        try {
            // console.log('getWalletBalances_' + this.coreType + '_' + this.tokenType);

            let walletAddresses = await this.getWalletAddresses();

            let batch = new this.client.BatchRequest();

            for (let addrData of walletAddresses) {
                batch.add(this.client.eth.getBalance.request(addrData.paymentAddr, (err, res) => {
                    if (err) throw err
                }));
            }

            let result = await batch.execute();

            let formattedBalances = [];

            for (let key in walletAddresses) {

                let resultBal = result.response[key] || 0;

                let checkSumAddress = this.client.utils.toChecksumAddress(walletAddresses[key].paymentAddr);

                formattedBalances[checkSumAddress] = this.client.utils.fromWei(resultBal, 'ether');
            }

            return formattedBalances;
        } catch (err) {
            throw err;
        }

    }

    //Sends push tx with funder for btc fee if funder is specified.
    //funder, recipient in run.config
    async sendTransaction(params) {
        try {
            console.log('sendTransaction_' + this.coreType + '_' + this.tokenType);

            //declare
            let sender = params.sender;
            let recipient = params.recipient;
            let amount = params.amount;
            let gasLimit = params.gasLimit || null;

            if (!this.client.utils.isAddress(sender) || !this.client.utils.isAddress(recipient)) {
                throw new Error("Invalid address as sender or recipient");
            }

            // If amount is number convert to string
            if (!isNaN(amount)) {
                amount = amount.toString();
            }

            let senderWeiBalance = await this.client.eth.getBalance(sender);
            let senderBalance = this.client.utils.fromWei(senderWeiBalance, 'ether');

            if (Number(senderBalance) < Number(amount)) {
                throw new Error("Not enough funds in sender address");
            }

            // Convert amount to Wei
            let weiAmount = this.client.utils.toWei(amount, 'ether');

            // The gas price is determined by the last few blocks median gas price. GasPrice is the wei per unit of gas
            let medianGasPrice = await this.client.eth.getGasPrice();
            //Increase gasprice by 50%
            medianGasPrice = (Math.trunc(Number(medianGasPrice) * 1.2)).toString()


            let hash = null;

            await SQL.db.transaction(async t1 => {

                let nodeNonce = null;
                let currNonce = null;
                let nonceRecord = null;

                // Determine the nonce
                if (sender == lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW) {
                    nonceRecord = await SQL.configs.findOne({
                        where: {
                            conf_code: 'ETH_HOT_WALLET_NONCE'
                        },
                        transaction: t1,
                        lock: t1.LOCK.UPDATE
                    });

                    currNonce = nonceRecord.conf_value;

                    nodeNonce = await this.client.eth.getTransactionCount(sender);

                    if (nodeNonce > currNonce) {
                        currNonce = nodeNonce;
                    }

                } else {
                    currNonce = await this.client.eth.getTransactionCount(sender);
                }

                let txObj = {
                    nonce: this.client.utils.toHex(currNonce),
                    from: sender,
                    to: recipient,
                    value: this.client.utils.toHex(weiAmount),
                    gasPrice: this.client.utils.toHex(medianGasPrice)
                };

                if (gasLimit == null) {
                    gasLimit = Math.ceil(await this.client.eth.estimateGas(txObj) * 1);
                }

                txObj['gasLimit'] = gasLimit;

                let balParams = {
                    address: sender
                };

                let balance = await this.getBalance(balParams);

                // If want to send ALL remaining funds from address
                // Need to reduce amount sent to allow for gas cost
                if (amount == balance) {
                    let estimatedWeiCost = gasLimit * medianGasPrice;

                    let newValue = weiAmount - estimatedWeiCost;
                    txObj['value'] = this.client.utils.toHex(newValue);
                }

                // console.log(txObj);

                let result = await SQL.ethereum_keys.findOne({
                    where: {
                        ek_address: sender
                    }
                });

                let password = this.walletPassword;

                let account = this.client.eth.accounts.decrypt(result.ek_keyJson, password);
                // console.log(txObj);
                let signedTx = await account.signTransaction(txObj);
                // console.log(signedTx)

                let currentEpoch = Math.floor(new Date() / 1000);
                await result.update({
                    ek_lastSignedEpoch: currentEpoch
                });


                if (!this.auto_send) {
                    return {
                        skip: "Send transaction is switched off by auto_send:false"
                    }
                }

                // let receipt = this.client.eth.sendSignedTransaction(signedTx.rawTransaction);

                this.client.eth.sendSignedTransaction(signedTx.rawTransaction, (error, result) => {

                    if (error) {
                        lib.bot.sendMonGrpMessage("-E- sendTransaction_" + this.coreType + "_" + this.tokenType + " Error: \n" + error);
                    }

                });

                hash = signedTx.transactionHash;

                // //call fetch transaction details to confirm it is recorded.
                // let txParam = {
                //     txid: hash
                // }

                // var resHash = await this.getTransaction(txParam);

                // if(!resHash){
                //     throw new Error("Transaction was not recorded on blockchain");
                // }

                if (sender == lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW) {
                    await nonceRecord.update({
                        conf_value: parseFloat(currNonce) + 1
                    }, {
                        transaction: t1
                    });
                }

                return Promise.resolve();

            }).then(result => {

            }).catch(err => {
                throw err;
            });

            return hash;

        } catch (err) {
            throw err;
        }

    }

    async computeAddressReceivedSQL(params) {
        try {
            // console.log('computeAddressReceivedSQL_' + this.coreType + '_' + this.tokenType);

            let address = params.address;

            if (!address || typeof address != "string") {
                // console.log("-E- txid param not valid.")
                return {
                    error: "Please make sure that argument specified is a string."
                };
            }

            //fetch all scheduled forward tx that are not equals to INVALID
            var totalAmt = 0
            totalAmt = await SQL.usdt_clear_batches.sum('amount', {
                where: {
                    node: this.coreType,
                    token: this.tokenType,
                    paymentAddr: address,
                    status: {
                        [lib.Op.notIn]: ['INVALID', 'OPEN']
                    }
                }
            })

            if (!totalAmt) {
                totalAmt = 0
            }

            return totalAmt;

        } catch (err) {
            throw err;
        }

    }
}

module.exports = {
    EthereumCore,
    lib
};