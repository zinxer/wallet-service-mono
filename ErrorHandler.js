const lib = require("./lib/lib");
const log = require("./lib/console_log.js");

async function LogError(params){
    var error = params.error;
    var shorten;
    var stack;
    if(error.stack){
        stack = JSON.stringify(error.stack).toString();
        if(error.params != undefined){
            stack += "\nParams : " + JSON.stringify(error.params).toString();
        }
        stack = stack.substring(1, stack.length);
        shorten = stack.split('\\n')[0];
    }
    else{
        shorten = stack = params.error;
    } 
    var botmsg = "Type : " + params.type + "\n\nError Message : " + params.msg + "\n\nMore : " + shorten; 
    lib.bot.sendGrpMessage(botmsg);
    await upsert({
        //values
        log_type            :   params.type,
        log_cat1            :   params.cat1,
        log_cat2            :   params.cat2,
        log_cat3            :   params.cat3,
        log_message         :   params.msg,
        log_error           :   stack,
        log_created_epoch   :   parseInt(Date.now()/1000),
    }, 
    { //condition
        log_type            :   params.type,
        log_cat1            :   params.cat1 == undefined ? null :  params.cat1,
        log_cat2            :   params.cat2 == undefined ? null :  params.cat2,
        log_cat3            :   params.cat3 == undefined ? null :  params.cat3,
        log_message         :   params.msg,
    }).catch(err => {
        console.log("\n\n\n");
        log.error(err);
        console.log("\n\n\n");
    });
}

function upsert(values, condition) {
    return lib.SQL.logs
        .findOne({ where: condition })
        .then(function(obj) {
            if(obj) { // update
                return obj.update(values);
            }
            else { // insert
                return lib.SQL.logs.create(values);
            }
        });
}

module.exports = {
    LogError
}