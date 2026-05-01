export const handler = async (event) => {
  const jsonHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...jsonHeaders,
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  if (!process.env.HUGGINGFACE_API_KEY) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Missing HUGGINGFACE_API_KEY" })
    };
  }

  try {
    const { prompt } = JSON.parse(event.body || "{}");
    if (!prompt?.trim()) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Prompt is required" })
      };
    }

    const res = await fetch("https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`
      },
      body: JSON.stringify({
        inputs: prompt.trim(),
        parameters: {
          num_inference_steps: 20,
          guidance_scale: 7.5,
          width: 1024,
          height: 1024
        }
      })
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: jsonHeaders,
        body: JSON.stringify({ error: data.error?.message || "Image generation failed" })
      };
    }

    // Convert Hugging Face image response to base64 data URL
    const imageBuffer = await res.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const dataUrl = `data:image/png;base64,${base64Image}`;
    
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        image: dataUrl
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: error.message })
    };
  }
};