// Firebase project config — these values are NOT secret. Firebase's web config identifies which
// project to talk to; it doesn't grant access to anything by itself. Real access control comes
// from Firestore Security Rules (see firestore.rules) and Firebase Auth, not from hiding this
// object. It's normal and safe for this file to be committed and shipped in the built app.
//
// Filled in from the "The Practice App" Firebase project (the-practice-app-52ce6), web app
// "practice-app-web", registered via the Firebase console on Sam's behalf.
export const firebaseConfig = {
  apiKey: "AIzaSyC7DnfYxPPgQBwq_SqVqq7lgDsvdGTy5Yw",
  authDomain: "the-practice-app-52ce6.firebaseapp.com",
  projectId: "the-practice-app-52ce6",
  storageBucket: "the-practice-app-52ce6.firebasestorage.app",
  messagingSenderId: "980802982428",
  appId: "1:980802982428:web:77e988768374ab76ecc5d9",
};
