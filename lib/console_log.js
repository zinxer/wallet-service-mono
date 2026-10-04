function currTime() {
    var city = 'Singapore'
    var offset = '+8'


    var d = new Date()
    var utc = d.getTime() + (d.getTimezoneOffset() * 60000)
    var nd = new Date(utc + (3600000 * offset))
    var datetime = nd.toLocaleString()
    datetime = datetime.replace(" AM", 'AM: ')
    datetime = datetime.replace(" PM", 'PM: ')
    datetime = datetime.replace(" ", '')

    return datetime
}


module.exports = {
        debug: async function(message) {
            console.log('-D- ' + currTime() + message)
        }, //end of debug

        info: async function(message) {
            console.log('-I- ' + currTime() + message)
        }, //end of info

        warning: async function(message) {
            console.log('-W- ' + currTime() + message)
        }, //end of warning

        error: async function(message) {
            console.log('-E- ' + currTime() + message)
        }, //end of error

    } //end of module.exports