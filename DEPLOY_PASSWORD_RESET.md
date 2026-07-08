# Deploy Password Reset Function - Quick Guide

## What Was Changed

### 1. Backend Function (Mobile API)
Added a new endpoint `/reset-password-after-otp` that allows resetting passwords using server-side permissions without requiring the old password.

**File:** `appwrite/functions/Mobile API/src/main.ts`

**New Features:**
- Type: `ResetPasswordAfterOTPRequest` (userId, newPassword)
- Helper function: `resetPasswordAfterOTP()` 
- Endpoint: `POST /reset-password-after-otp`

### 2. Client-Side Update
Updated `src/lib/auth.ts` to call the new backend endpoint instead of trying to update password directly.

**Function:** `resetPasswordAfterOTPVerification(userId, newPassword)`

### 3. UI Updates
Updated `src/screens/auth/PasswordResetScreen.tsx` to match the design with:
- Masked email display
- "Didn't get a code?" section
- Styled "Resend Code" button (outlined)
- "Need help?" link

## Current Status

✅ **Built:** TypeScript compiled to JavaScript successfully  
❌ **Not Deployed:** Function needs to be pushed to Appwrite

## How to Deploy

> ⚠️ **Functions are owned by `samplefinder-admin/`, not this repo.** The canonical Function
> source + Appwrite CLI config live in `samplefinder-admin/appwrite/functions/`. Do **not** run
> `appwrite push` from inside `samplefinder-app/`: any `appwrite/` directory or `appwrite.config.json`
> here is stray CLI output that may hold stale code or point at the wrong project. Deploy from the
> admin repo.

### Option 1: Appwrite CLI (from the admin repo)

```bash
cd ../samplefinder-admin/appwrite
appwrite push functions --functionId 69308117000e7a96bcbb   # Mobile API
```

### Option 2: Manual Deployment via Appwrite Console

1. Go to your Appwrite Console: https://nyc.cloud.appwrite.io/console
2. Navigate to your project: **SampleFinder**
3. Go to **Functions** → **Mobile API**
4. Click **Create Deployment**
5. Select **Manual** deployment
6. Upload the following files from `samplefinder-admin/appwrite/functions/Mobile API/`:
   - `src/main.js` (the compiled JavaScript)
   - `package.json`
7. Click **Deploy**

### Option 3: Using Appwrite Dashboard Git Integration

If you've set up Git integration for your functions:

1. Commit and push your changes to your repository
2. Appwrite will automatically deploy the updated function

## Test After Deployment

Once deployed, test the password reset flow:

1. Go to Forgot Password screen
2. Enter your email
3. Receive OTP code
4. Enter the code
5. Create a new password
6. **This should now work!** ✅

## Verify Deployment

After deploying, you can verify the new endpoint is available:

```bash
# Call the function to see available endpoints
curl -X GET https://nyc.cloud.appwrite.io/v1/functions/69308117000e7a96bcbb/executions/ping
```

The response should now include `/reset-password-after-otp` in the list of available endpoints.

## If You Still Get Errors

If you still see "Invalid endpoint" errors after deployment:

1. **Wait a minute** - Appwrite may take a moment to activate the new deployment
2. **Check deployment status** in Appwrite Console
3. **Check function logs** for any errors during deployment
4. **Verify the build** - Make sure `src/main.js` contains the new endpoint code

## Function Details

- **Function ID:** `69308117000e7a96bcbb`
- **Function Name:** Mobile API
- **Runtime:** node-22
- **Entrypoint:** `src/main.js`
- **Path:** `samplefinder-admin/appwrite/functions/Mobile API`

## Need Help?

If you encounter issues:

1. Check Appwrite function logs in the console
2. Verify the TypeScript was compiled correctly: `npm run build`
3. Make sure you're deploying the correct function ID
4. Check that your Appwrite CLI is logged in: `appwrite login`
