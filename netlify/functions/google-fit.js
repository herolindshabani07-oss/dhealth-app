exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const token = event.headers['authorization']?.replace('Bearer ', '') || 
                  event.headers['Authorization']?.replace('Bearer ', '');
    
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'No token provided' }) };
    }

    const now = Date.now();
    const dayMs = 86400000;

    // Fetch Steps, HR, Calories njëherësh
    const fitnessRes = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        aggregateBy: [
          { dataTypeName: 'com.google.step_count.delta' },
          { dataTypeName: 'com.google.heart_rate.bpm' },
          { dataTypeName: 'com.google.calories.expended' },
          { dataTypeName: 'com.google.distance.delta' },
          { dataTypeName: 'com.google.active_minutes' }
        ],
        bucketByTime: { durationMillis: dayMs },
        startTimeMillis: now - dayMs,
        endTimeMillis: now
      })
    });

    if (!fitnessRes.ok) {
      const errText = await fitnessRes.text();
      return { 
        statusCode: fitnessRes.status, 
        headers, 
        body: JSON.stringify({ error: `Google Fit error: ${fitnessRes.status}`, details: errText }) 
      };
    }

    const data = await fitnessRes.json();
    
    let steps = 0, hr = 0, calories = 0, distance = 0, activeMin = 0;

    if (data.bucket && data.bucket[0]) {
      data.bucket[0].dataset.forEach(ds => {
        if (!ds.point || ds.point.length === 0) return;
        const point = ds.point[0];
        const val = point.value[0];
        
        if (ds.dataSourceId?.includes('step_count'))    steps     = val.intVal || 0;
        if (ds.dataSourceId?.includes('heart_rate'))    hr        = Math.round(val.fpVal || 0);
        if (ds.dataSourceId?.includes('calories'))      calories  = Math.round(val.fpVal || 0);
        if (ds.dataSourceId?.includes('distance'))      distance  = Math.round((val.fpVal || 0) / 1000 * 100) / 100;
        if (ds.dataSourceId?.includes('active_minutes'))activeMin = val.intVal || 0;
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        steps, hr, calories, distance, activeMin,
        synced: new Date().toISOString() 
      })
    };

  } catch (error) {
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: error.message }) 
    };
  }
};
