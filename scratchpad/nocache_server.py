import http.server, socketserver, os
os.chdir("app")
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()
    def log_message(self, *a): pass
with socketserver.TCPServer(("127.0.0.1", 8643), H) as httpd:
    print("no-cache test server on http://127.0.0.1:8643")
    httpd.serve_forever()
