#!/usr/bin/env python3
"""Serve this folder with caching turned off.

    python3 serve.py            # then open the address it prints

A page opened from file:// cannot fetch its own data files — Chrome and Safari
both refuse — so the tool needs a server. `python3 -m http.server` works, but it
lets the browser cache app.js and templates.js, and a reader who reloads after an
edit sees the old page and reasonably concludes nothing changed. That happened,
so the server that ships with the tool sends no-store.
"""
import functools, http.server, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8731


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', PORT), NoCache) as httpd:
    print(f'Module Boundary Matrix — http://localhost:{PORT}/index.html')
    print('caching is off, so a plain reload always shows the current build')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
