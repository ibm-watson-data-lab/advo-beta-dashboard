var express = require('express')
var app = express()
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var redis = require('redis');
var async = require('async');

/*
 * This application requires a Redis service. You must
 *  - define environment variable REDIS_URL or
 *  - bind a Redis service instance named "redis-service" (in Bluemix) or
 *  - run Redis locally (alongside this application)
 */


// get cloudfoundry config
var cfenv = require('cfenv'),
  appEnv = cfenv.getAppEnv();

console.log(JSON.stringify(appEnv));

var redis_url = process.env.REDIS_URL;
if (!redis_url) {
  // Custom REDIS_URL is not defined. If a Redis service instance is bound to this app use it.
  if(appEnv.hasOwnProperty('services')) {
    // check if a Compose for Redis service instance is bound to this app
    if ((appEnv.services.hasOwnProperty('compose-for-redis')) && (appEnv.services['compose-for-redis'].length > 0)) { 
      var redisSvc = appEnv.services['compose-for-redis'][0];
      if((redisSvc.hasOwnProperty('credentials')) && redisSvc.credentials.hasOwnProperty('uri')) {
        redis_url = redisSvc.credentials.uri;
      } 
    }
    // check if a RedisCloud service instance is bound to this app
    else if ((appEnv.services.hasOwnProperty('rediscloud')) && (appEnv.services['rediscloud'].length > 0)) { 
      var redisSvc = appEnv.services['rediscloud'][0];
      if((redisSvc.hasOwnProperty('credentials')) && redisSvc.credentials.hasOwnProperty('hostname') && 
          redisSvc.credentials.hasOwnProperty('password') && redisSvc.credentials.hasOwnProperty('port')) {
        redis_url = 'redis://x:' + redisSvc.credentials['password'] + '@' + redisSvc.credentials['hostname'] + ':' + redisSvc.credentials['port'];
      } 
    }
  }
}

if (!redis_url) {
  // Custom REDIS_URL is not defined and no Redis service was bound to the application. 
  // Use the default if this application runs locally
  if(appEnv.isLocal) {
    redis_url = 'redis://localhost:6379';
  }
  else {
    console.log('This application cannot start be started because it is not configured. You must');
    console.log(' - define environment variable REDIS_URL (format: "redis://host:port") or');
    console.log(' - bind a Redis service instance or');
    console.log(' - run this application on the same machine where Redis is running (port 6379).');
    process.exit(1);
  }
}

console.log('Redis repository URL: ' + redis_url);

var redisClient = redis.createClient(redis_url);

// template report
var latestReport = {
  funnel: {
    users: 0,
    baskets: 0,
    orders:0
  },
  lastHour: {
    sumItems:0,
    sumOrders: 0
  }
}

// fetch data from Redis
var generateLatestReport  = function(callback) {
  async.series([
    function(done) {
      redisClient.hgetall('funnel', done);
    }
  ], function(err, results) {
    if (!err) {
      var funnel = results[0];
      if(funnel) {
        latestReport.funnel.users = parseInt(funnel.login_count);
        latestReport.funnel.baskets = parseInt(funnel.basket_count);
        latestReport.funnel.orders = parseInt(funnel.checkout_count);
        latestReport.lastHour.sumItems = parseInt(funnel.basket_total);
        latestReport.lastHour.sumOrders = parseInt(funnel.checkout_total);
      }
    }
    callback(null, latestReport);
  });
}

// serve out static content
app.use(express.static('public'))

// on connection send the user the latest report
io.on('connection', function(socket) {
  socket.emit('report', latestReport);
});

// every minute calculate latest stats and broadcast to everyone
setInterval(function() {
  generateLatestReport(function(err, data) {
    io.local.emit('report', latestReport);
  });
}, 1000);


// listen
server.listen(appEnv.port, '0.0.0.0', function () {
  console.log('Dashboard app listening on port', appEnv.port);
})

// metrics collector; remove or comment out to disable
require("metrics-tracker-client").track();
