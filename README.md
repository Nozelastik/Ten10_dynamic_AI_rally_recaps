
# Ten10 Dynamic AI Rally Recaps

AI-generated rally journalism for Ten10 Motorsport WRC Championship.

## Architecture

- Reads rally results from the existing Ten10 results repository.
- Uses Gemini to generate original WRC2 and JWRC recaps.
- Stores editorial history and storylines in editorial-sidecar.json.
- Publishes the latest recaps as separate JSON files.
- The Blogger website reads the published JSON files.

## Required GitHub secret

Repository Settings > Secrets and variables > Actions

GEMINI_API_KEY

Never place the API key in source code or public JSON files.

## Generate a rally recap

1. Open the Actions tab.
2. Select Generate Ten10 AI Rally Recaps.
3. Click Run workflow.
4. Enter the season folder, e.g. Season 5.
5. Enter the exact event folder, e.g. R3 Mexico.
6. Leave force disabled unless regenerating an existing rally.
7. Run the workflow.

Only run after the event's final stage results have been uploaded
and the original results index has been updated.

## Data privacy

Only public rally results and public driver display names are sent
to the Gemini API. Do not add private personal information.

## Important

The editorial sidecar begins tracking history from the first rally
processed by this system. Earlier results are not automatically
included in its historical statistics.
