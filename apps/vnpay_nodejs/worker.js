// worker.js
// Import app Express của bạn
import app from './app.js'; // hoặc từ file chính của bạn

// Adapter để chạy Express trên Workers
function expressAdapter(expressApp) {
  return async (request, env, ctx) => {
    const url = new URL(request.url);
    
    return new Promise((resolve, reject) => {
      try {
        // Tạo request object tương thích với Express
        const req = {
          method: request.method,
          url: url.pathname + url.search,
          originalUrl: url.pathname + url.search,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          headers: {},
          body: null,
          on: (event, callback) => {
            if (event === 'data' && req.body) callback(JSON.stringify(req.body));
            if (event === 'end') callback();
          }
        };

        // Copy headers
        for (const [key, value] of request.headers) {
          req.headers[key] = value;
        }

        // Tạo response object tương thích với Express
        const res = {
          statusCode: 200,
          headers: {},
          setHeader: (key, value) => {
            res.headers[key] = value;
          },
          json: (data) => {
            res.body = JSON.stringify(data);
            resolve(new Response(res.body, {
              status: res.statusCode,
              headers: {
                'Content-Type': 'application/json',
                ...res.headers
              }
            }));
          },
          send: (data) => {
            if (typeof data === 'object') {
              res.body = JSON.stringify(data);
              res.setHeader('Content-Type', 'application/json');
            } else {
              res.body = data;
            }
            resolve(new Response(res.body, {
              status: res.statusCode,
              headers: res.headers
            }));
          },
          end: (data) => {
            if (data) {
              res.body = data;
            }
            resolve(new Response(res.body || null, {
              status: res.statusCode,
              headers: res.headers
            }));
          },
          status: (code) => {
            res.statusCode = code;
            return res;
          }
        };

        // Xử lý request body
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
          const contentType = request.headers.get('content-type') || '';
          
          if (contentType.includes('application/json')) {
            request.json().then(body => {
              req.body = body;
              expressApp(req, res, (err) => {
                if (err) {
                  reject(err);
                }
              });
            }).catch(err => {
              reject(err);
            });
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            request.text().then(text => {
              const body = {};
              new URLSearchParams(text).forEach((value, key) => {
                body[key] = value;
              });
              req.body = body;
              expressApp(req, res, (err) => {
                if (err) {
                  reject(err);
                }
              });
            });
          } else {
            request.text().then(text => {
              req.body = text;
              expressApp(req, res, (err) => {
                if (err) {
                  reject(err);
                }
              });
            });
          }
        } else {
          // GET, DELETE, etc.
          expressApp(req, res, (err) => {
            if (err) {
              reject(err);
            }
          });
        }
      } catch (error) {
        reject(error);
      }
    });
  };
}

const handler = expressAdapter(app);

export default {
  async fetch(request, env, ctx) {
    try {
      return await handler(request, env, ctx);
    } catch (error) {
      return new Response(JSON.stringify({ 
        error: 'Internal Server Error',
        message: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};