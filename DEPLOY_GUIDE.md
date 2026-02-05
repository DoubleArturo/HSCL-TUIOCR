# Deploying to Vercel (Free & Fast)

You do **NOT** need to give me your account password. The safest and most professional way is to let **Vercel** automatically pull your code from **GitHub**.

## Step 1: Push Code to GitHub (If you haven't already)
1.  Go to [GitHub.com](https://github.com/new) and create a **new repository** (e.g., `invoice-ocr-tool`).
2.  Run these commands in your project terminal:
    ```bash
    git init
    git add .
    git commit -m "Ready for deployment"
    git branch -M main
    git remote add origin https://github.com/YOUR_USERNAME/invoice-ocr-tool.git
    git push -u origin main
    ```

## Step 2: Connect Vercel to GitHub
1.  Go to [Vercel.com](https://vercel.com) and Sign Up (Log in with GitHub is easiest).
2.  On the dashboard, click **"Add New..."** -> **"Project"**.
3.  You will see your GitHub repositories. Click **"Import"** next to `invoice-ocr-tool`.

## Step 3: Configure & Deploy
1.  **Framework Preset**: Select **Vite** (it should detect auto-detect).
2.  **Environment Variables**:
    *   Click the "Environment Variables" section.
    *   Add your API Key:
        *   Name: `VITE_GEMINI_API_KEY`
        *   Value: `your_gemini_api_key_here`
3.  Click **"Deploy"**.

## Finish!
*   Wait about 1 minute.
*   Vercel will give you a permanent URL (e.g., `https://invoice-ocr-tool.vercel.app`).
*   **Share this URL** with your colleagues. They can use it immediately!
*   **Update**: Whenever you modify code and `git push`, Vercel will auto-update the site.
