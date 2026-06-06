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

// Remote command from dispatch → driver device (ping location, ring, recall, refresh, alert)
exports.sendCommandNotification = functions.database
  .ref('/commands/{driverUid}/{cmdKey}')
  .onCreate(async (snapshot, context) => {
    const cmd = snapshot.val();
    const driverUid = context.params.driverUid;
    if (!cmd || !cmd.type) return null;

    const titles = {
      ping_location: '📍 Location requested',
      ring_device:   '🔔 Dispatch is calling',
      recall_base:   '🏠 Return to base',
      refresh_app:   '🔄 Refresh required',
      alert:         '📢 Dispatch alert',
    };
    const bodies = {
      ping_location: 'Dispatch needs your current location',
      ring_device:   'Open the app — dispatch needs you now',
      recall_base:   'Please head back to base',
      refresh_app:   'Tap to reload and resync your app',
      alert:         cmd.message || 'New message from dispatch',
    };
    // Loud commands demand attention — stronger vibration + sticky notification
    const loud = cmd.type === 'ring_device' || cmd.type === 'alert' || cmd.type === 'recall_base';

    const message = {
      notification: {
        title: titles[cmd.type] || '⚡ Dispatch command',
        body: bodies[cmd.type] || (cmd.message || ''),
      },
      data: {
        type: 'command',
        command: String(cmd.type),
        cmdKey: String(context.params.cmdKey),
        message: String(cmd.message || ''),
        from: String(cmd.from || 'Dispatch'),
      },
      webpush: {
        notification: {
          icon: '/icon-driver.png',
          vibrate: loud ? [400, 120, 400, 120, 400, 120, 400] : [200, 100, 200],
          requireInteraction: loud,
          tag: 'cmd-' + driverUid + '-' + cmd.type,
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
