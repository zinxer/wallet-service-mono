const EthereumCore = require('./EthereumCore.class.js').EthereumCore;
const lib = require("../lib.js");
const log = require("../console_log.js");
const Web3  = require('web3');
const abiDecoder  = require('abi-decoder');
const SQL = lib.SQL

/*
* Parent class for ERC20 based Tokens
* Main class containing general ERC20 functions for manipulating and getting information on ERC20 tokens in the Ethereum Blockchain 
* Contains general functions that can be used by all child classes
*/

class EthereumTokenCore extends EthereumCore {

    constructor() {
        super();

        // Placeholders to be overwritten by token class
        this.tokenType = 'USDT';

        // Placeholders to be overwritten by token class
        this.tokenAddress = "0xdac17f958d2ee523a2206206994597c13d831ec7";
        
        // Placeholders to be overwritten by token class
        let contractABI = [
            {
                "constant": true,
                "inputs": [],
                "name": "name",
                "outputs": [
                    {
                        "name": "",
                        "type": "string"
                    }
                ],
                "payable": false,
                "stateMutability": "view",
                "type": "function"
            }
        ];

        abiDecoder.addABI(contractABI);

        // Get ERC20 Token contract instance
        this.contract = new this.client.eth.Contract(
            contractABI, 
            this.tokenAddress, 
            {
                defaultGasPrice: '20000000000' // default gas price in wei, 20 gwei in this case
            }
        );

    }

    async convertFromWei(amount){
        try{
            if(this.decimals == undefined){
                this.decimals = await this.contract.methods.decimals().call();
            }

            
            let value = parseFloat(amount) / Math.pow(10, this.decimals.toString());
            // let value = this.client.utils.fromWei(amount.toString(), this.unitMapping[this.decimals]);

            return value.toString();
        }catch(err){
            throw err;
        }
    }

    async convertToWei(amount){
        try{
            if(this.decimals == undefined){
                this.decimals = await this.contract.methods.decimals().call();
            }

            let weiValue = parseFloat(amount) * Math.pow(10, this.decimals.toString());
            // let weiValue = this.client.utils.toWei(amount.toString(), this.unitMapping[this.decimals]);

            return weiValue.toFixed(0);
        }catch(err){
            throw err;
        }
    }

    async estimateEtherCost(params) {
        try{
            // console.log('estimateEtherCost_' + this.coreType + '_' + this.tokenType);

            let sender = params.sender;
            let recipient = params.recipient;
            let amount = params.amount;

            // Convert amount to Wei
            let weiAmount = await this.convertToWei(amount);
            let hexWeiAmount = this.client.utils.toHex(weiAmount);

            // The gas price is determined by the last few blocks median gas price. GasPrice is the wei per unit of gas
            let medianGasPrice = await this.client.eth.getGasPrice();
            //Increase gasprice by 50%
            medianGasPrice = (Math.trunc(Number(medianGasPrice)*1.2)).toString()

            // Determine the nonce
            let count = await this.client.eth.getTransactionCount(sender);
            
            let txObj = {
                nonce: this.client.utils.toHex(count),
                from: sender,
                to: this.tokenAddress,
                gasPrice: this.client.utils.toHex(medianGasPrice),
                data: this.contract.methods.transfer(recipient, hexWeiAmount).encodeABI()
            };
            
            let gasEstimate = await this.client.eth.estimateGas(txObj) * 1;
            gasEstimate = Math.ceil(gasEstimate);

            let totalWeiCost = this.client.utils.toBN(gasEstimate * medianGasPrice);

            let etherCost = this.client.utils.fromWei(totalWeiCost, 'ether');

            return etherCost;
        }catch(err){
            throw err;
        }    
    }

    async estimateFee(params) {
        try{
            // console.log('estimateFee_' + this.coreType + '_' + this.tokenType);

            let etherCost = await this.estimateEtherCost(params);
            
            let feeUsd = etherCost * (await this.getEthPrice('USD'));

            return feeUsd;
        }catch(err){
            throw err;
        }        
    }
    
    //Returns error if txid is not omni type
    async getTransaction(params) {
        try{
            // console.log('getTransaction_' + this.coreType + '_' + this.tokenType);
            
            let txid = params.txid;

            let result = null;
            let decodedInput = null;
            
            // Transaction will not appear immediately. Try for certain amount of times until info is available.
            for(let i = 1; i <= 20; i++){
                
                result = await this.client.eth.getTransaction(txid);
                
                if(result != null){
                    decodedInput = lib.abiDecoder.decodeMethod(result.input);
                    // console.log("Number of tries:" + i);
                    break;
                }

                await this.delay(5000)
            }
            
            if(result == null){
                throw new Error("Unable to get transaction info");
            }
            // console.log(result);
            result['paymentAddr'] = decodedInput.params[0].value;
            result['amount'] = await this.convertFromWei(decodedInput.params[1].value);

            let confParams = {
                txid: txid,
                blockNumber: result.blockNumber
            }
            result['confirmations'] = await this.getConfirmations(confParams);

            let status = false;
            let gasUsed = null;

            if(result['confirmations'] > 0){
                let txReceipt = await this.client.eth.getTransactionReceipt(txid);
                status = txReceipt.status;
                gasUsed = txReceipt.gasUsed;
            }

            result['gasUsed'] = gasUsed;

            result['valid'] = status;

            result['fee'] = null;

            if(gasUsed != null){
                let gasPriceGwei = this.client.utils.fromWei(result.gasPrice, 'gwei');

                // let feeWei = this.client.utils.fromWei(this.client.utils.toBN(gasUsed).mul(this.client.utils.toBN(gasPriceGwei)), 'gwei');
                let feeWei = this.client.utils.fromWei((gasUsed * gasPriceGwei).toFixed(0), 'gwei');

                result['fee'] = feeWei;
            }

            return result;
            
        }catch(err){
            throw err;
        }
    }
    
    async getBalance(params) {
        try{
            // console.log('getBalance_' + this.coreType + '_' + this.tokenType);

            let address = params.address || null;

            if (address == null) {
                throw new Error("No address provided");
            }

            let result = null;

            if(Array.isArray(params.address)){
                
                result = [];

                let batch = new this.client.BatchRequest();

                for(let address of params.address){
                    batch.add(this.contract.methods.balanceOf(address).call.request({}, (err, res) => {if(err) throw err} ));
                }

                let balances = await batch.execute();
                
                let cnt = 0;

                for(let address of params.address){
                    
                    let balance = await this.convertFromWei(balances.response[cnt]);
                    
                    result[address] = balance;

                    cnt++;
                }
                
            }else{

                let bigBalance = await this.contract.methods.balanceOf(address).call();
                
                result = await this.convertFromWei(bigBalance);
            }

            return result;
        }catch(err){
            throw err;
        }
        
    }

    async getWalletBalances(params) {
        try{
            //console.log('getWalletBalances_' + this.coreType + '_' + this.tokenType);

            let walletAddresses = await this.getWalletAddresses();

            let batch = new this.client.BatchRequest();

            for(let addrData of walletAddresses){
                batch.add(this.contract.methods.balanceOf(addrData.paymentAddr).call.request({}, (err, res) => {if(err) throw err} ));
            }

            let result = await batch.execute();

            let formattedBalances = [];

            for(let key in walletAddresses){

                let resultBal = result.response[key] || 0;
                
                let balance = await this.convertFromWei(resultBal);

                let checkSumAddress = this.client.utils.toChecksumAddress(walletAddresses[key].paymentAddr);
                
                formattedBalances[checkSumAddress] = balance;
            }
            return formattedBalances;
        }catch(err){
            throw err;
        }
        
    }
    
    //Sends push tx with funder for btc fee if funder is specified.
    //funder, recipient in run.config
    async sendTransaction(params) {
        try{
            console.log('sendTransaction_' + this.coreType + '_' + this.tokenType);
            
            //declare
            let sender = params.sender;
            let recipient = params.recipient;
            let amount = params.amount;
            let gasLimit = params.gasLimit || null;

            if(!this.client.utils.isAddress(sender) || !this.client.utils.isAddress(recipient)){
                throw new Error("Invalid address as sender or recipient");
            }

            let senderWeiBalance = await this.contract.methods.balanceOf(sender).call();
            let senderBalance = await this.convertFromWei(senderWeiBalance);

            if(Number(senderBalance) < Number(amount)){
                throw new Error("Not enough funds in sender address");
            }

            // Convert amount to Wei
            let weiAmount = await this.convertToWei(amount);
            let hexWeiAmount = this.client.utils.toHex(weiAmount);

            // The gas price is determined by the last few blocks median gas price. GasPrice is the wei per unit of gas
            let medianGasPrice = await this.client.eth.getGasPrice();
            //Increase gasprice by 50%
            medianGasPrice = (Math.trunc(Number(medianGasPrice)*1.2)).toString()

            let hash = null;
            let skip = false;
            
            await SQL.db.transaction(async t1 => {
                
                let nodeNonce = null;
                let currNonce = null;
                let nonceRecord = null;

                // Determine the nonce
                if(sender == lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW){
                    nonceRecord = await SQL.configs.findOne({
                        where: {conf_code: 'ETH_HOT_WALLET_NONCE'},
                        transaction: t1,
                        lock: t1.LOCK.UPDATE
                    });

                    currNonce = nonceRecord.conf_value;

                    nodeNonce = await this.client.eth.getTransactionCount(sender);
                    
                    if(nodeNonce > currNonce){
                        currNonce = nodeNonce;
                    }
                    
                }else{
                    currNonce = await this.client.eth.getTransactionCount(sender);
                }
                
                let txObj = {
                    nonce: this.client.utils.toHex(currNonce),
                    from: sender,
                    to: this.tokenAddress,
                    gasPrice: this.client.utils.toHex(medianGasPrice),
                    data: this.contract.methods.transfer(recipient, hexWeiAmount).encodeABI()
                };

                if(gasLimit == null){
                    gasLimit = Math.ceil( await this.client.eth.estimateGas(txObj) * 1);
                }
                
                txObj['gasLimit'] = gasLimit;
                
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
                
                if (!this.auto_send) {
                    skip = true;
                    return Promise.resolve();
                }

                let currentEpoch = Math.floor(new Date() / 1000);
                await result.update({ek_lastSignedEpoch: currentEpoch});
    
                // let receipt = this.client.eth.sendSignedTransaction(signedTx.rawTransaction);

                this.client.eth.sendSignedTransaction(signedTx.rawTransaction, (error, result) =>  {
                    
                    if(error){
                        lib.bot.sendMonGrpMessage("-E- sendTransaction_" + this.coreType + "_" + this.tokenType + " Error: \n" + error);
                    }

                });
    
                hash = signedTx.transactionHash;
    
                // //call fetch transaction details to confirm it is recorded.
                // let txParam = {
                //     txid: hash
                // }
                
                // var resHash = await this.getTransaction(txParam);
                // console.log(resHash)
                
                // if(!resHash){
                //     throw new Error("Transaction was not recorded on blockchain");
                // }

                if(sender == lib.CONFIG.ETH_WALLET_ADDR.WITHDRAW){
                    await nonceRecord.update({
                        conf_value: parseFloat(currNonce) + 1
                    }, {transaction: t1});
                }
                
                return Promise.resolve();

            }).then(hash => {
                
            }).catch(err => {
                throw err;
            });

            if(skip){
                return {
                    skip: "Send transaction is switched off by auto_send:false"
                }
            }
            
            return hash;
            
        }catch(err){
            throw err;
        }
        
    }

    async computeAddressReceivedSQL(params) {
        try{
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

        }catch(err){
            throw err;
        }
        
    }
}

module.exports = EthereumTokenCore;