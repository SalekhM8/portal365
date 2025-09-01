// Use built-in fetch in Node 18+

async function runDiagnostic() {
  try {
    console.log('🔑 Logging in as admin...');
    
    // First, sign in to get session
    const loginResponse = await fetch('http://localhost:3004/api/auth/signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'admin@portal365.com',
        password: 'admin123'
      })
    });
    
    const cookies = loginResponse.headers.get('set-cookie');
    console.log('Login response status:', loginResponse.status);
    
    if (!cookies) {
      console.error('❌ No cookies received from login');
      return;
    }
    
    console.log('🔍 Running diagnostic...');
    
    // Run diagnostic with session cookies
    const diagnosticResponse = await fetch('http://localhost:3004/api/admin/diagnose-missing-payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies
      },
      body: JSON.stringify({})
    });
    
    const result = await diagnosticResponse.json();
    console.log('📊 Diagnostic Results:');
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Error running diagnostic:', error);
  }
}

runDiagnostic();
