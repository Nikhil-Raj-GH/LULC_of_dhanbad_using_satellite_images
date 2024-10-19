//visit Google Eearth Engine and sign in
//use the given shape file as roi
//select 5 labels(as you wish) in GEE as given below
                     // var landcoverPalette = [
                     //    '#162bff', // water (0)
                     //    '#ffffff', // coal (1)
                     //    '#ffc82d', // crop (2)
                     //    '#2eff32', // forest (3)
                     //    '#bf04c2', // Urban (4)
                     //  ];

// Multi-year Landsat classification and visualization from 1984 to present
var startYear = 1987;
var endYear = 2023;  // Update this to the current year

// Ensure roi is a single geometry
var unifiedRoi = roi.geometry().dissolve();

// Function to get dataset for a specific year
function getDatasetForYear(year) {
  var startDate = ee.Date.fromYMD(year, 1, 1);
  var endDate = startDate.advance(1, 'year');
  
  if (year < 1999) {
    return ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
      .filterDate(startDate, endDate)
      .filterBounds(unifiedRoi)
      .filterMetadata('CLOUD_COVER', 'less_than', 10);
  } else if (year < 2013) {
    return ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
      .filterDate(startDate, endDate)
      .filterBounds(unifiedRoi)
      .filterMetadata('CLOUD_COVER', 'less_than', 10);
  } else if (year < 2022) {
    return ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterDate(startDate, endDate)
      .filterBounds(unifiedRoi)
      .filterMetadata('CLOUD_COVER', 'less_than', 10);
  } else {
    return ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
      .filterDate(startDate, endDate)
      .filterBounds(unifiedRoi)
      .filterMetadata('CLOUD_COVER', 'less_than', 10);
  }
}

// Applies scaling factors
function applyScaleFactors(image) {
  var opticalBands = image.select('SR_B.').multiply(0.0000275).add(-0.2);
  var thermalBands = image.select('ST_B.*').multiply(0.00341802).add(149.0);
  return image.addBands(opticalBands, null, true).addBands(thermalBands, null, true);
}

// Create Training Data (merge all classes)
var training = Urban.merge(Forest).merge(Water).merge(Crop).merge(Coal);
var label = 'Class';

// Function to process and classify image for a specific year and calculate accuracy
function processForYear(year) {
  var dataset = getDatasetForYear(year);
  var rescale = dataset.map(applyScaleFactors);
  var image = rescale.median().clip(unifiedRoi);
  
  // Visualization parameters for RGB composite
  var visualization = {
    bands: ['SR_B4', 'SR_B3', 'SR_B2'],  // Red, Green, Blue
    min: -0.2,  // Adjusted to match the scaling applied
    max: 0.3
  };
  
  // Add RGB layer for visualization
  var rgbImage = image.visualize(visualization);
  
  var bands = ['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7'];  // Common bands across Landsat sensors
  var input = image.select(bands);
  
  // Sample training data from regions of interest
  var trainImage = input.sampleRegions({
    collection: training,
    properties: [label],
    scale: 30
  });
  
  var trainingData = trainImage.randomColumn();
  var trainSet = trainingData.filter(ee.Filter.lt('random', 0.8));
  var testSet = trainingData.filter(ee.Filter.gte('random', 0.8));
  
  // Train the classifier using Gradient Boosting Trees (XGBoost proxy)
// Train the classifier using Gradient Boosting Trees (XGBoost proxy)
var classifier = ee.Classifier.smileGradientTreeBoost({
  numberOfTrees: 100,      // Number of trees in the ensemble
  shrinkage: 0.1,          // Learning rate
  maxNodes: 32,            // Maximum number of leaf nodes in each tree
  samplingRate: 0.8        // Stochastic rate for tree boosting (optional)
})
.train({
  features: trainSet,
  classProperty: label,
  inputProperties: bands
});

// Classify the image
var classified = input.classify(classifier);


  
  // Define a color palette for the classified image
  var landcoverPalette = [
    '#162bff', // water (0)
    '#ffffff', // coal (1)
    '#ffc82d', // crop (2)
    '#2eff32', // forest (3)
    '#bf04c2', // Urban (4)
  ];
  
  // Visualize the classified image
  var classifiedVis = classified.visualize({
    min: 0,
    max: 4,
    palette: landcoverPalette
  });

  // Evaluate accuracy using the test set for the current year
  var testAccuracy = testSet.classify(classifier);
  var confusionMatrix = testAccuracy.errorMatrix({
    actual: label,
    predicted: 'classification'
  });
  
  // Print accuracy metrics for the specific year
  print('Confusion Matrix for year ' + year, confusionMatrix);
  print('Overall Accuracy for year ' + year, confusionMatrix.accuracy());
  print('Kappa for year ' + year, confusionMatrix.kappa());
  
  return {
    rgb: rgbImage,
    classification: classifiedVis,
    accuracyMetrics: confusionMatrix
  };
}

// Loop through each year, process images, and set up exports with individual accuracy calculation
for (var year = startYear; year <= endYear; year++) {
  var results = processForYear(year);
  
  // Export the RGB composite for the year
  Export.image.toDrive({
    image: results.rgb,
    description: 'Landsat_RGB_' + year,
    scale: 30,
    region: unifiedRoi,
    maxPixels: 1e13,
    fileFormat: 'GeoTIFF',
    formatOptions: {
      cloudOptimized: true
    }
  });
  
  // Export the classified image for the year
  Export.image.toDrive({
    image: results.classification,
    description: 'Landsat_Classified_' + year,
    scale: 30,
    region: unifiedRoi,
    maxPixels: 1e7,  // Reduced to avoid exceeding Google Earth Engine limits
    fileFormat: 'GeoTIFF',
    formatOptions: {
      cloudOptimized: true
    }
  });
  
  // Add layers to the map (only for the most recent year to avoid clutter)
  if (year === endYear) {
    Map.addLayer(results.rgb, {}, 'RGB Composite ' + year);
    Map.addLayer(results.classification, {}, 'Classification ' + year);
  }
}

// Center map on the region of interest (ROI)
//Map.addLayer(ee.Image().paint(unifiedRoi, 1, 2), {palette: ['red']}, 'ROI Outline');
Map.centerObject(unifiedRoi);
