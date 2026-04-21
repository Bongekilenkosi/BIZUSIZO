'use strict';
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Railway streams stdout as plain text — pretty-print in dev, JSON in prod
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
  base: { service: 'bizusizo' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;

