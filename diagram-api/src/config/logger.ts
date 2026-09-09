export const pinoHttpOptions = {
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.passwordHash',
      'req.body.refreshToken',
      'req.body.accessToken',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'refreshToken',
      'accessToken',
    ],
    censor: '[Redacted]',
  },
};
