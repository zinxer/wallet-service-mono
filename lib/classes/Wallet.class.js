/*
* Main Class to consolidate all blockchain transaction related functions
* Instantiates all supported token cores to allow a central class and function to be used to call token specific functions
*/

class Wallet {

    constructor() {

        this.arrCoinCores = [];

        this.validCoins = ['OMNI_USDT', 'OMNI_BTC', 'ETH_ETH', 'ETH_USDT'];       

        for(let coinType of this.validCoins){
            this.arrCoinCores[coinType] = this.createCore(coinType);
        }        
    }
    
    createCore(coinType) {

        let [node, token] = coinType.split('_');

        if(node == 'OMNI'){
            let classpath = './CoinCore_' + coinType + '.class.js';
            let CoinCore = require(classpath);
            return new CoinCore();
        }else{

            if(token == 'ETH'){
                let classpath = './EthereumCore.class.js';
                let EthCore = require(classpath);
                return new EthCore.EthereumCore(); 
            }

            let classpath = './EthToken_'+ token +'.class.js';
            let Token = require(classpath);
            return new Token();
        }        
    }

    async getAllBalances(params){
        if (!Array.isArray(params.addresses)) {
            throw new Error("Invalid argument, expect array of addresses.");
        }

        let balances = [];

        try{
            
            // Use array of addresses and create object with addresses as keys
            for(let key in params.addresses){
                balances[params.addresses[key]] = {};
            }

            for(let coinType of this.validCoins){

                // Initialize balances of this coin type to 0
                for(let address in balances){
                    balances[address][coinType] = 0;
                }

                let params = {
                    coinType: coinType,
                    address: null
                }
                let coinBalances = await this.arrCoinCores[coinType].getWalletBalances(params);

                // console.log(coinBalances);

                for(let address in coinBalances){

                    if(balances[address]){
                        balances[address][coinType] = coinBalances[address];
                    }
                    
                }

            }

            // console.log(balances);
        }catch(err){
            throw err;
        }

        return balances;
    }

    async getFeePrice(params){

        let [node, token] = params.coinType.split('_');
        
        if(node == 'ETH'){
            return this.arrCoinCores[params.coinType].getEthPrice();
        }else{
            return this.arrCoinCores[params.coinType].getBtcPrice();
        }
    }

    async getBtcPrice(params) {
        return this.arrCoinCores[params.coinType].getBtcPrice();
    }

    async getEthPrice(params) {
        return this.arrCoinCores[params.coinType].getEthPrice();
    }

    async estimateEtherCost(params) {
        return this.arrCoinCores[params.coinType].estimateEtherCost(params);
    }

    async estimateFee(params) {
        return this.arrCoinCores[params.coinType].estimateFee(params);
    }

    async dumpPrivateKey(params) {
        return this.arrCoinCores[params.coinType].dumpPrivateKey(params);
    }
    
    async importPrivateKey(params) {
        return this.arrCoinCores[params.coinType].importPrivateKey(params);
    }

    async createAcc(params) {
        return this.arrCoinCores[params.coinType].createAcc(params);
    }

    async validateAddr(params) {
        return this.arrCoinCores[params.coinType].validateAddr(params);
    }
    
    async getTransaction(params) {
        return this.arrCoinCores[params.coinType].getTransaction(params);
    }

    async getPendingTx(params) {
        return this.arrCoinCores['OMNI_USDT'].getPendingTx(params);
    }
    
    async listTransactions(params) {
        return this.arrCoinCores[params.coinType].listTransactions(params);
    }

    async listAccounts(params) {
        return this.arrCoinCores[params.coinType].listAccounts(params);
    }
    
    async getBalance(params) {
        return this.arrCoinCores[params.coinType].getBalance(params);
    }

    async getWalletBalances(params) {
        return this.arrCoinCores[params.coinType].getWalletBalances(params);
    }

    async getWalletTotal(params) {
        return this.arrCoinCores[params.coinType].getWalletTotal(params);
    }
    
    async sendTransaction(params) {
        return this.arrCoinCores[params.coinType].sendTransaction(params);
    }

    async computeAddressReceivedSQL(params) {
        return this.arrCoinCores[params.coinType].computeAddressReceivedSQL(params);
    }
}

module.exports = Wallet;

