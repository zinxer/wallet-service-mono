const CoinCore = require('./CoinCore.class.js').CoinCore;
const lib = require('./CoinCore.class.js').lib;
const SQL = lib.SQL

/*
* Sample template for an OMNI Token Coin Core
*/

class CoinCore_Template extends CoinCore {

    constructor() {
        super();

        this.coreType = 'TEMPLATE';
    }
    
    async estimateFee(params) {
        console.log('estimateFee_' + this.coreType);
    }

    async dumpPrivateKey(params) {
        console.log('dumpPrivateKey_' + this.coreType);
    }
    
    async importPrivateKey(params) {
        console.log('importPrivateKey_' + this.coreType);
    }
    
    
    async createAcc(params) {
        console.log('createAcc_' + this.coreType);
    }
    
    async getTransaction(params) {
        console.log('getTransaction_' + this.coreType);
    }
    
    //address needs to be from wallet.
    //Returns complete transactions for wallets that are generated and imported to wallet.dat since usage.
    async listTransactions(params) {
        console.log('listTransactions_' + this.coreType);
    }

    //List all accounts in wallet.dat
    async listAccounts(params) {
        console.log('listAccounts_' + this.coreType);
    }
    
    async getBalance(params) {
        console.log('getBalance_' + this.coreType);
    }

    async getWalletBalances(params) {
        console.log('getWalletBalances_' + this.coreType);
    }
    
    async sendTransaction(params) {
        console.log('sendTransaction_' + this.coreType);
    }
}

module.exports = CoinCore_Template;