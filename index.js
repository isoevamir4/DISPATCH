const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// Send push to ALL devices a driver is logged into
async function sendToDriver(driverUid, message) {
  const db = admin.database();

  // Get all device tokens
  const tokensSnap = await db.ref(`drivers/${driverUid}/fcmTokens`).get();
  const singleSnap = await db.ref(`drivers/${driverUid}/fcmToken`).get();

  const tokens = new Set();
  if (singleSnap.val()) tokens.add(singleSnap.val());
  if (tokensSnap.val()) Object.values(tokensSnap.val()).forEach(t => tokens.add(t));

  if (!tokens.size) return;

  const promises = Array.from(tokens).map(token =>
    admin.messaging().send({ ...message, token }).catch(async err => {
      if (err.code === 'messaging/registration-token-not-registered') {
        // Remove stale token
        await db.ref(`drivers/${driverUid}/fcmToken`).remove();
        const tSnap = await db.ref(`drivers/${driverUid}/fcmTokens`).get();
        if (tSnap.val()) {
          Object.entries(tSnap.val()).forEach(([k, v]) => {
            if (v === token) db.ref(`drivers/${driverUid}/fcmTokens/${k}`).remove();
          });
        }
      }
    })
  );

  return Promise.all(promises);
}

// New job dispatched
exports.sendJobNotification = functions.database
  .ref('/jobs/{driverUid}')
  .onCreate(async (snapshot, context) => {
    const job = snapshot.val();
    const driverUid = context.params.driverUid;
    if (!job || job.status !== 'pending') return null;

    const message = {
      notification: {
        title: '⚡ New Job',
        body: 'Pickup: ' + (job.pickup || '—') + (job.fare ? ' · $' + job.fare : ''),
      },
      data: {
        type: 'new_job', driverUid,
        phone: String(job.phone || ''), pickup: String(job.pickup || ''), fare: String(job.fare || ''),
      },
      webpush: {
        notification: {
          icon: '/icon-driver.png', vibrate: [300, 100, 300, 100, 300],
          requireInteraction: true, tag: 'new-job-' + driverUid,
        },
        fcmOptions: { link: 'https://driver.iziktaxi.com' }
      }
    };

    return sendToDriver(driverUid, message);
  });

// Job cancelled or reassigned
exports.sendCancelNotification = functions.database
  .ref('/jobs/{driverUid}/status')
  .onUpdate(async (change, context) => {
    const newStatus = change.after.val();
    const driverUid = context.params.driverUid;
    if (newStatus !== 'cancelled' && newStatus !== 'reassigned') return null;

    const message = {
      notification: {
        title: newStatus === 'reassigned' ? '🔄 Job Reassigned' : '❌ Job Cancelled',
        body: newStatus === 'reassigned' ? 'Your job was reassigned' : 'Your job was cancelled by dispatch',
      },
      data: { type: newStatus },
      webpush: {
        notification: {
          icon: '/icon-driver.png', vibrate: [200, 100, 200],
          requireInteraction: false, tag: 'job-status-' + driverUid,
        },
        fcmOptions: { link: 'https://driver.iziktaxi.com' }
      }
    };

    return sendToDriver(driverUid, message);
  });

// Scheduled job assigned
exports.sendScheduledJobNotification = functions.database
  .ref('/upcoming_jobs/{driverUid}/{jobKey}')
  .onCreate(async (snapshot, context) => {
    const job = snapshot.val();
    const driverUid = context.params.driverUid;
    if (!job || job.status !== 'pending') return null;

    const when = (job.date && job.time) ? job.date + ' at ' + job.time : 'Upcoming';
    const message = {
      notification: {
        title: '🕐 Scheduled Job',
        body: when + ' · ' + (job.pickup || '—'),
      },
      data: { type: 'scheduled_job', driverUid },
      webpush: {
        notification: {
          icon: '/icon-driver.png', vibrate: [200, 100, 200],
          requireInteraction: true, tag: 'scheduled-' + driverUid,
        },
        fcmOptions: { link: 'https://driver.iziktaxi.com' }
      }
    };

    return sendToDriver(driverUid, message);
  });
