const os = require('node:os');
const net = require('node:net');
function privateAddress(address) {
  return net.isIPv4(address) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
}
function addresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat().filter(row => row && !row.internal && privateAddress(row.address)).map(row => row.address))];
}
function allowedHost(host) {
  const match = /^(localhost|127\.0\.0\.1|groceries\.local|[\d.]+)(?::(\d+))?$/.exec(host);
  return !!match && (!match[2] || Number(match[2]) <= 65535) && (['localhost','127.0.0.1','groceries.local'].includes(match[1]) || addresses().includes(match[1]));
}
module.exports = { privateAddress, addresses, allowedHost };
