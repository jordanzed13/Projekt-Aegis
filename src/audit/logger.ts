import winston from 'winston';

export const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: 'audit.log' })]
});
