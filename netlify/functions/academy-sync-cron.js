// مزامنة تلقائية كل 5 دقائق — تفعّل أي دفعة أكاديمية فاتت الويبهوك
const { runSync } = require('./_academy-sync-core');
exports.handler = async () => runSync({});
