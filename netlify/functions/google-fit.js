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
    const token = (event.headers['authorization'] || event.headers['Authorization'] || '').replace('Bearer ', '');
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No token' }) };

    const now = Date.now();
    const dayMs = 86400000;

    const response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        aggregateBy: [
          { dataTypeName: 'com.google.step_count.delta' },
          { dataTypeName: 'com.google.heart_rate.bpm' },
          { dataTypeName: 'com.google.calories.expended' }
        ],
        bucketByTime: { durationMillis: dayMs },
        startTimeMillis: now - dayMs,
        endTimeMillis: now
      })
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      console.log('Google API error:', response.status, responseText);
      return { statusCode: response.status, headers, body: JSON.stringify({ error: `Google API error: ${response.status}` }) };
    }

    const data = JSON.parse(responseText);
    let steps = 0, hr = 0, calories = 0;

    if (data.bucket && data.bucket[0]) {
      data.bucket[0].dataset.forEach(ds => {
        if (!ds.point || ds.point.length === 0) return;
        const val = ds.point[0].value[0];
        if (ds.dataSourceId && ds.dataSourceId.includes('step_count')) steps = val.intVal || 0;
        if (ds.dataSourceId && ds.dataSourceId.includes('heart_rate')) hr = Math.round(val.fpVal || 0);
        if (ds.dataSourceId && ds.dataSourceId.includes('calories')) calories = Math.round(val.fpVal || 0);
      });
    }

    console.log('Sync success - Steps:', steps, 'HR:', hr, 'Cal:', calories);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ steps, hr, calories, distance: 0, synced: new Date().toISOString() })
    };

  } catch (error) {
    console.log('Function error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
