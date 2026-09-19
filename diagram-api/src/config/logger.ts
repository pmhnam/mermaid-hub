export const pinoHttpOptions = {
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  serializers: {
    req: (request: { url?: string; [key: string]: unknown }) => ({
      ...request,
      url: request.url?.startsWith('/api/auth/google')
        ? request.url.split('?')[0]
        : request.url,
    }),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.passwordHash',
      'req.body.refreshToken',
      'req.body.accessToken',
      'req.query.code',
      'req.query.state',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'refreshToken',
      'accessToken',
    ],
    censor: '[Redacted]',
  },
};
