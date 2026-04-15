export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-xl shadow p-8 space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Login &amp; Authentication</h1>

        <section aria-label="Email and password fields">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Sign In</h2>
          <div className="space-y-3">
            <input type="email" placeholder="Email address" className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm" />
            <input type="password" placeholder="Password" className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm" />
            <button className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700">Sign In</button>
          </div>
        </section>

        <section aria-label="OAuth provider buttons">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Or continue with</h2>
          <div className="space-y-2">
            <button className="w-full border border-gray-300 rounded-lg py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Google</button>
            <button className="w-full border border-gray-300 rounded-lg py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">GitHub</button>
          </div>
        </section>

        <section aria-label="Forgot password and registration links">
          <div className="flex justify-between text-sm">
            <a href="#" className="text-indigo-600 hover:underline">Forgot password?</a>
            <a href="#" className="text-indigo-600 hover:underline">Create account</a>
          </div>
        </section>

        <section aria-label="Error messages">
          {/* Error messages rendered here */}
        </section>
      </div>
    </div>
  );
}
