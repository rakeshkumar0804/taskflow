const mongoose = require('mongoose');
const { supportsTransactions } = require('../services/executionEventService');

class BufferedHttpResponse extends Error {
  constructor(statusCode, body) {
    super('HTTP response requires transaction rollback');
    this.name = 'BufferedHttpResponse';
    this.statusCode = statusCode;
    this.body = body;
  }
}

/**
 * Run an HTTP mutation and its execution-ledger append in one MongoDB
 * transaction when the deployment supports transactions. Mongoose's async
 * transaction context makes every query/save in the controller participate,
 * including calls made by nested services.
 *
 * Responses and socket broadcasts are buffered until commit. A controlled
 * 4xx/5xx response aborts the transaction and is delivered after rollback.
 * Standalone MongoDB keeps the explicitly disclosed synchronous fallback.
 */
function withLedgerTransaction(handler) {
  return async function ledgerTransactionRoute(req, res, next) {
    if (!supportsTransactions()) {
      return handler(req, res, next);
    }

    const originalJson = res.json.bind(res);
    const originalIo = req.io;
    let bufferedResponse = null;
    let bufferedEmits = [];

    try {
      await mongoose.connection.transaction(async (session) => {
        bufferedResponse = null;
        bufferedEmits = [];
        req.ledgerSession = session;

        res.json = (body) => {
          bufferedResponse = { statusCode: res.statusCode, body };
          return res;
        };

        if (originalIo && typeof originalIo.emit === 'function') {
          req.io = {
            ...originalIo,
            emit: (...args) => {
              bufferedEmits.push(args);
              return true;
            },
          };
        }

        await handler(req, res, next);

        if (!bufferedResponse) {
          throw new Error('Mutation handler completed without an HTTP response');
        }

        if (bufferedResponse.statusCode >= 400) {
          throw new BufferedHttpResponse(
            bufferedResponse.statusCode,
            bufferedResponse.body
          );
        }
      });

      res.json = originalJson;
      req.io = originalIo;
      delete req.ledgerSession;

      for (const args of bufferedEmits) {
        originalIo?.emit?.(...args);
      }

      res.status(bufferedResponse.statusCode);
      return originalJson(bufferedResponse.body);
    } catch (error) {
      res.json = originalJson;
      req.io = originalIo;
      delete req.ledgerSession;

      if (error instanceof BufferedHttpResponse) {
        res.status(error.statusCode);
        return originalJson(error.body);
      }

      return next(error);
    }
  };
}

module.exports = { withLedgerTransaction };
