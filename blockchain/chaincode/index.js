'use strict';
const { Contract } = require('fabric-contract-api');
const { methods } = require('./lib/batches');
class HerbChain extends Contract {
  constructor() { super('HerbChain'); }
}
Object.assign(HerbChain.prototype, methods);
module.exports.contracts = [HerbChain];
