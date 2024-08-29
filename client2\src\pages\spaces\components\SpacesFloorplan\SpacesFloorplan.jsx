import React, { Component } from "react";
import { flow, isEmpty, size } from "lodash";
import { hot } from "react-hot-loader";
import { injectIntl } from "react-intl";

// Constants
import { containerTypes } from "constants/containerTypes";
import {
  DEFAULT_MARKER_SIZE,
  DEFAULT_POINT_SIZE,
} from "constants/defaultScales";
import { drawingModes } from "constants/drawingModes";
import { legendTypes } from "pages/spaces/constants/legendTypes";
import { elementTypes } from "components/Floorplan2/constants/constants";

// HoCs
import withAnalytics from "components/hoc/withAnalytics";
import withRedux from "components/hoc/withRedux";

// Styles
import colors from "styles/colors";
import { getSpaceStyle } from "./space";
import {
  getSpaceCustomLayerStyle,
  isSpaceErased,
  isSpacePaintedTag,
  tagEraserIcon,
  tagIcon,
} from "components/Floorplan2/components/FloorplanShapes/SpaceStyles";

// Services
import { areEqualPoints } from "services/shapeUtils";
import { detectElement, isCustomLayer } from "services/spaceEditorUtils";
import {
  findSpaceHolePointsBetweenBounds,
  findSpacePointsBetweenBounds,
  findSpacesBetweenBounds,
} from "services/spaces";

// Components
import {
  EditableShape,
  Floorplan,
  FloorplanLabels,
  FloorplanPopup,
  FloorplanShapes,
  Label,
  Shape,
  MarkerShape,
} from "components/Floorplan2";
import SpacePopupCard from "components/SpacePopupCard";

import {
  getLabelOffsetY,
  getLabelsForSpaces,
} from "components/Floorplan2/utils/space";

import FloorplanRectUiHelper from "components/Floorplan2/components/FloorplanRectUiHelper/FloorplanRectUiHelper";
import Ruler from "pages/spaces/components/Ruler/Ruler";
import TagIcon from "pages/spaces/components/TagIcon/TagIcon";

const NEW_SPACE_ID = 1;

export class SpacesFloorplanWrapper extends Component {
  static defaultProps = {
    floorId: null,
    labelSize: 6,
    showLabels: true,
    spaces: [],
  };

  state = {
    disableMoveFloorplan: false, //Used for dragging points instead of panning the floor
    selectionRect: null, // Dimensions for drawing the selection rectangle
  };

  componentDidUpdate(prevProps) {
    const {
      actions: { clearRenumberingDuplicateNames },
    } = this.props;
    if (prevProps.floorId !== this.props.floorId) {
      // Clear renumbering duplicate names if the floor has changed
      clearRenumberingDuplicateNames();
    }
  }

  componentWillUnmount() {
    const {
      actions: { closeSpacePopup },
    } = this.props;
    closeSpacePopup();
  }

  createLabel = (label, index) => {
    const {
      labelOptions: { labelFontSize },
      maxLabelChars,
      spaceEditor: { renumberingDuplicateNames },
    } = this.props;
    let fillColor = null;

    const offsetY = getLabelOffsetY(label, index, labelFontSize);

    if (
      label.lines[0] &&
      renumberingDuplicateNames.includes(label.lines[0].text)
    )
      fillColor = colors.red;

    return (
      <Label
        key={this.getKey(label.id, index)}
        spaceId={label.spaceId}
        label={label}
        labelSize={labelFontSize}
        lineIndex={index}
        labelBoxColor={colors.white}
        maxLabelChars={maxLabelChars}
        offsetY={offsetY}
        disablePointerEvents={true}
        {...fillColor && { fillColor }}
      />
    );
  };

  getDrawingMode = () => {
    const {
      spaceEditor: {
        drawingSettings: { drawCustom, drawRectangle, point, spaceType },
        spacesEditMode,
        polylineAddPanelOpen,
        polylineEditPanelOpen,
        tags,
        panningMode,
        markersPanelOpen,
        markers,
      },
      spaceRuler,
    } = this.props;
    if (panningMode) {
      return drawingModes.NONE;
    }
    if (tags.paintActive || tags.eraseActive) {
      return drawingModes.TAGGING;
    }
    if (spaceRuler.visible) {
      return drawingModes.DRAW_RULER;
    }
    if (
      !spacesEditMode ||
      (!polylineAddPanelOpen && !polylineEditPanelOpen && !markersPanelOpen)
    ) {
      return drawingModes.NONE;
    }

    if (polylineAddPanelOpen) {
      if (spaceType) {
        if (spaceType.isPointType) {
          return drawingModes.CREATE_SPACE_POINT;
        }
        if (drawCustom) {
          return drawingModes.CREATE_SPACE_CUSTOM;
        }
        if (drawRectangle) {
          return drawingModes.CREATE_SPACE_RECTANGLE;
        }
      }
      return drawingModes.NONE;
    }

    if (polylineEditPanelOpen) {
      if (point) {
        return drawingModes.EDIT_SPACE;
      }
      return drawingModes.TRANSFORM_SPACES;
    }

    if (markersPanelOpen) {
      if (markers.selectedPanelMarker !== null) {
        return drawingModes.CREATE_MARKERS;
      }

      if (markers.selectedMarkers !== null) {
        return drawingModes.TRANSFORM_MARKERS;
      }
    }

    return drawingModes.NONE;
  };

  getKey = (spaceId, shapeIndex) => `s.${spaceId}.${shapeIndex}`;

  /**
   * @return event.spaceId
   * @return event.position
   * @return event.imagePoint
   * @return event.originalTarget
   */

  handleFloorplanPress = event => {
    const { elementType, holeIndex, spaceId, pointIndex, imagePoint } = event;
    const {
      actions: {
        uiMouseTrackerUpdate,
        uiMouseTrackerSetDragTarget,
        spaceRulerSetStartPoints,
        spaceEditorSetCurrentAddedTags,
        spaceEditorSetCurrentRemovedTags,
      },
      spaceEditor: {
        drawingSettings: { spaceType, multiSelect },
        tags,
        currentlyAddedTags,
        currentlyDeletedTags,
        workPointShapeIds,
        selectedSpaces,
      },
    } = this.props;
    const currentDrawingMode = this.getDrawingMode();
    if (
      (currentDrawingMode === drawingModes.EDIT_SPACE ||
        currentDrawingMode === drawingModes.TRANSFORM_SPACES) &&
      (elementType === elementTypes.POINT ||
        elementType === elementTypes.SPACE) &&
      !isEmpty(selectedSpaces) &&
      !multiSelect
    ) {
      uiMouseTrackerUpdate({ mouse: imagePoint, imagePoint, old: imagePoint });
      uiMouseTrackerSetDragTarget({
        elementType,
        spaceId,
        pointIndex,
        holeIndex,
      });
      this.setState({ disableMoveFloorplan: true, selectionRect: null });
    } else if (
      currentDrawingMode === drawingModes.CREATE_SPACE_RECTANGLE &&
      spaceType &&
      !spaceType.isPointType
    ) {
      this.setState({
        disableMoveFloorplan: true,
        selectionRect: {
          left: imagePoint.x,
          right: imagePoint.x,
          top: imagePoint.y,
          bottom: imagePoint.y,
        },
      });
    } else if (multiSelect && elementType !== elementTypes.POINT) {
      this.setState({
        disableMoveFloorplan: true,
        selectionRect: {
          left: imagePoint.x,
          right: imagePoint.x,
          top: imagePoint.y,
          bottom: imagePoint.y,
        },
      });
    } else if (
      multiSelect &&
      (elementType === elementTypes.POINT || elementType === elementTypes.SPACE)
    ) {
      uiMouseTrackerUpdate({ mouse: imagePoint, imagePoint, old: imagePoint });
      uiMouseTrackerSetDragTarget({
        elementType,
        spaceId,
        pointIndex,
        holeIndex,
      });
      this.setState({ disableMoveFloorplan: true, selectionRect: null });
    } else if (currentDrawingMode === drawingModes.DRAW_RULER) {
      uiMouseTrackerUpdate({ mouse: imagePoint, imagePoint, old: imagePoint });
      spaceRulerSetStartPoints({
        startPoint: imagePoint,
      });
    } else if (tags.paintActive && spaceId) {
      const { active } = tags;
      if (!currentlyAddedTags[spaceId] && !workPointShapeIds[spaceId]) {
        spaceEditorSetCurrentAddedTags({
          ...currentlyAddedTags,
          [spaceId]: active.id,
        });
      }
    } else if (tags.eraseActive && spaceId) {
      const { active } = tags;
      const {
        tagChanges: { newPaintedHashTags },
      } = this.props.spaceEditor;
      const possibleTags = tags.tagHash[tags.active.id];
      const canDelete =
        possibleTags && possibleTags.find(space => space.id === spaceId);
      const isTemporaryPainted =
        newPaintedHashTags[active.id] &&
        newPaintedHashTags[active.id].find(spaceId => spaceId === spaceId);
      if (
        (!currentlyDeletedTags[spaceId] &&
          !workPointShapeIds[spaceId] &&
          canDelete) ||
        isTemporaryPainted
      ) {
        spaceEditorSetCurrentRemovedTags({
          ...currentlyDeletedTags,
          [spaceId]: active.id,
        });
      }
    } else if (
      currentDrawingMode === drawingModes.TRANSFORM_MARKERS &&
      elementType === elementTypes.MARKER
    ) {
      uiMouseTrackerUpdate({ mouse: imagePoint, imagePoint, old: imagePoint });
      uiMouseTrackerSetDragTarget({
        elementType,
        spaceId,
        pointIndex,
        holeIndex,
      });
      this.setState({ disableMoveFloorplan: true, selectionRect: null });
    }
  };

  handleFloorplanDrag = event => {
    const {
      actions: {
        uiMouseTrackerUpdate,
        spaceEditorSetCurrentAddedTags,
        spaceEditorSetCurrentRemovedTags,
      },
      uiMouseTracker,
      spaceEditor: {
        panningMode,
        currentlyEditedSpace,
        currentlyEditedPoints,
        drawingSettings: { point },
        tags,
        workPointShapeIds,
        currentlyAddedTags,
        currentlyDeletedTags,
        hashSpacesForFloor,
        selectedSpaces,
        markers,
      },
      spaceRuler,
    } = this.props;
    const { disableMoveFloorplan, selectionRect } = this.state;
    const spaceRulerMode = spaceRuler.visible;
    const tagMode = tags.paintActive || tags.eraseActive;
    uiMouseTrackerUpdate({
      mouse: event.position,
      imagePoint: event.imagePoint,
    });
    const currentDrawingMode = this.getDrawingMode();
    if (selectionRect && !panningMode && !spaceRulerMode) {
      event.preventDefaultAction = true;
      this.setState({
        selectionRect: {
          ...selectionRect,
          right: event.imagePoint.x,
          bottom: event.imagePoint.y,
        },
      });
    } else if (
      !isEmpty(uiMouseTracker.dragTarget) &&
      currentDrawingMode === drawingModes.TRANSFORM_SPACES &&
      selectedSpaces[uiMouseTracker.dragTarget.spaceId]
    ) {
      let { imagePoint } = uiMouseTracker;
      const delta = {
        x: event.imagePoint.x - imagePoint.x,
        y: event.imagePoint.y - imagePoint.y,
      };
      const newPoint = (point, mouseDelta) => {
        return { x: point.x + mouseDelta.x, y: point.y + mouseDelta.y };
      };

      const allKeys = Object.keys(selectedSpaces);

      allKeys.forEach(id => {
        const shape = selectedSpaces[id].shapes[0];
        Object.keys(shape.coordinates).forEach(key => {
          shape.coordinates[key] = newPoint(shape.coordinates[key], delta);
        });
        if (shape.holes) {
          Object.keys(shape.holes).forEach(holeKey => {
            const hole = shape.holes[holeKey];
            Object.keys(hole).forEach(key => {
              shape.holes[holeKey][key] = newPoint(
                shape.holes[holeKey][key],
                delta
              );
            });
          });
        }
      });
    } else if (uiMouseTracker.dragTarget && currentlyEditedSpace) {
      // update point position
      const {
        dragTarget: { spaceId, pointIndex, holeIndex },
        imagePoint,
      } = uiMouseTracker;

      // If we have a pointIndex and the spaceId matches the currently selected shape we will update
      // The point that has been moved as wee as any others in the current selection
      if (currentlyEditedSpace.id === spaceId && !isNaN(pointIndex)) {
        const delta = {
          x: event.imagePoint.x - imagePoint.x,
          y: event.imagePoint.y - imagePoint.y,
        };

        const newPoint = (point, mouseDelta) => {
          return { x: point.x + mouseDelta.x, y: point.y + mouseDelta.y };
        };
        // Update all the points in the current point selection
        const shape = currentlyEditedSpace.shapes[0];
        Object.keys(currentlyEditedPoints.coordinates).forEach(key => {
          shape.coordinates[key] = newPoint(shape.coordinates[key], delta);
          if (key != pointIndex) {
          }
        });
        Object.keys(currentlyEditedPoints.holes).forEach(holeKey => {
          const hole = currentlyEditedPoints.holes[holeKey];
          Object.keys(hole).forEach(key => {
            shape.holes[holeKey][key] = newPoint(
              shape.holes[holeKey][key],
              delta
            );
            if (key != pointIndex || holeKey != holeIndex) {
            }
          });
        });

        // If a point was dragged without initially being selected we need to update it too
        if (isNaN(holeIndex)) {
          // Check the contour point isn't in the selection
          if (!currentlyEditedPoints.coordinates[pointIndex]) {
            shape.coordinates[pointIndex] = newPoint(
              shape.coordinates[pointIndex],
              delta
            );
          }
        } else if (
          shape.holes &&
          holeIndex < shape.holes.length &&
          (!currentlyEditedPoints.holes[holeIndex] ||
            !currentlyEditedPoints.holes[holeIndex][pointIndex])
        ) {
          shape.holes[holeIndex][pointIndex] = newPoint(
            shape.holes[holeIndex][pointIndex],
            delta
          );
        }
      }
    } else if (uiMouseTracker.dragTarget && markers.selectedMarkers) {
      const {
        dragTarget: { spaceId },
        imagePoint,
      } = uiMouseTracker;
      const selectedMarkers = markers.selectedMarkers[spaceId];
      if (selectedMarkers) {
        const delta = {
          x: event.imagePoint.x - imagePoint.x,
          y: event.imagePoint.y - imagePoint.y,
        };
        const movingMarker = markers.spaces.find(space => space.id === spaceId);
        movingMarker.xCoordinate = imagePoint.x + delta.x;
        movingMarker.yCoordinate = imagePoint.y + delta.y;
        selectedMarkers.xCoordinate = imagePoint.x + delta.x;
        selectedMarkers.yCoordinate = imagePoint.y + delta.y;
      }
    }
    if (tagMode) {
      const { active } = tags;
      const element = detectElement(event);
      if (tags.paintActive) {
        if (element.spaceId) {
          let space = hashSpacesForFloor[element.spaceId];
          if (
            space &&
            !currentlyAddedTags[space.id] &&
            !workPointShapeIds[space.id]
          ) {
            spaceEditorSetCurrentAddedTags({
              ...currentlyAddedTags,
              [space.id]: active.id,
            });
          }
        }
      }
      if (tags.eraseActive) {
        if (element.spaceId) {
          const {
            spaceEditor: {
              tagChanges: { newPaintedHashTags },
            },
          } = this.props;

          const space = hashSpacesForFloor[element.spaceId];
          const possibleTags = tags.tagHash[tags.active.id];
          const canDelete =
            possibleTags &&
            possibleTags.find(space => space.id === element.spaceId);
          if (
            (!currentlyDeletedTags[element.spaceId] &&
              !workPointShapeIds[space.id] &&
              canDelete) ||
            (newPaintedHashTags[active.id] &&
              newPaintedHashTags[active.id].includes(space.id))
          ) {
            spaceEditorSetCurrentRemovedTags({
              ...currentlyDeletedTags,
              [space.id]: active.id,
            });
          }
        }
      }
    }
    event.preventDefaultAction =
      disableMoveFloorplan || spaceRulerMode || tagMode;
    if (panningMode) {
      event.preventDefaultAction = false;
    }
  };

  handleFloorplanRelease = event => {
    const { elementType, spaceId, pointIndex, holeIndex, imagePoint } = event;
    const {
      actions: {
        editableShapeFinishEditing,
        spaceEditorUpdateCurrentlyEditedSpace,
        spaceEditorUpdateMovedSpaces,
        spaceEditorSetSelectedPoints,
        uiMouseTrackerSetDragTarget,
        spaceEditorSetSelectedSpaces,
        spaceEditorSetCurrentlyEditedSpace,
        spaceRulerAddPoint,
        uiMouseTrackerUpdate,
        spaceEditorFinnishDrawingTags,
      },
      uiMouseTracker,
      spaceEditor: {
        panningMode,
        currentlyEditedSpace,
        drawingSettings: { spaceType, multiSelect },
        selectedSpaces,
        tags,
        currentlyAddedTags,
        markers,
      },
      spaces,
      uiViewerFloorscale,
      floorId,
      customLayerSpaces,
      bulkUpdate,
    } = this.props;
    const { selectionRect } = this.state;
    uiMouseTrackerSetDragTarget(null);
    this.setState({ disableMoveFloorplan: false, selectionRect: null });

    const currentDrawingMode = this.getDrawingMode();

    if (panningMode) {
      return;
    }

    if (currentDrawingMode == drawingModes.DRAW_RULER) {
      spaceRulerAddPoint({
        imagePoint: uiMouseTracker.imagePoint,
        uiViewerFloorscale: uiViewerFloorscale[floorId],
      });
      return;
    }

    if (currentDrawingMode == drawingModes.TAGGING) {
      spaceEditorFinnishDrawingTags(currentlyAddedTags);
      return;
    }

    if (
      selectionRect &&
      spaceType &&
      !spaceType.isPointType &&
      currentDrawingMode == drawingModes.CREATE_SPACE_RECTANGLE
    ) {
      const { left, right, top, bottom } = selectionRect;
      editableShapeFinishEditing([
        { x: left, y: top },
        { x: left, y: bottom },
        { x: right, y: bottom },
        { x: right, y: top },
      ]);
    }

    if (selectionRect && multiSelect) {
      const { left, right, top, bottom } = selectionRect;
      const topLeft = { x: left, y: top };
      const bottomRight = { x: right, y: bottom };
      const {
        drawingSettings: { point },
      } = this.props.spaceEditor;

      if (point && currentlyEditedSpace) {
        const editedPoints = findSpacePointsBetweenBounds(
          currentlyEditedSpace,
          topLeft,
          bottomRight
        );
        const holePoints = findSpaceHolePointsBetweenBounds(
          currentlyEditedSpace,
          topLeft,
          bottomRight
        );
        spaceEditorSetSelectedPoints({
          coordinates: editedPoints,
          holes: holePoints,
        });
        spaceEditorSetCurrentlyEditedSpace(currentlyEditedSpace);
      } else {
        const foundSpaces = findSpacesBetweenBounds(
          [...spaces, ...customLayerSpaces],
          topLeft,
          bottomRight
        );
        if (bulkUpdate.visible) {
          spaceEditorSetSelectedSpaces({
            ...selectedSpaces,
            ...foundSpaces,
          });
        } else {
          spaceEditorSetSelectedSpaces(foundSpaces);
          if (size(foundSpaces) > 0) {
            spaceEditorSetCurrentlyEditedSpace(null);
          }
          if (size(foundSpaces) === 1) {
            spaceEditorSetCurrentlyEditedSpace(foundSpaces[0]);
          }
        }
      }
    }

    let pointDragged = false;
    if (
      (uiMouseTracker &&
        uiMouseTracker.old &&
        uiMouseTracker.dragTarget &&
        uiMouseTracker.dragTarget.elementType === elementTypes.POINT) ||
      elementTypes.SPACE
    ) {
      pointDragged = !areEqualPoints(uiMouseTracker.old, imagePoint);
    }

    if (
      currentlyEditedSpace &&
      pointDragged &&
      currentlyEditedSpace.id === uiMouseTracker.dragTarget.spaceId &&
      uiMouseTracker.dragTarget.elementType !== elementTypes.SPACE
    ) {
      spaceEditorUpdateCurrentlyEditedSpace({
        elementType,
        holeIndex,
        imagePoint,
        pointIndex,
        spaceId,
      });
    }

    if (
      !isEmpty(selectedSpaces) &&
      pointDragged &&
      uiMouseTracker &&
      uiMouseTracker.dragTarget &&
      uiMouseTracker.dragTarget.elementType &&
      uiMouseTracker.dragTarget.elementType === elementTypes.SPACE
    ) {
      spaceEditorUpdateMovedSpaces();
    }

    if (
      !isEmpty(markers.selectedMarkers) &&
      pointDragged &&
      uiMouseTracker &&
      uiMouseTracker.dragTarget &&
      uiMouseTracker.dragTarget.elementType &&
      uiMouseTracker.dragTarget.elementType === elementTypes.MARKER
    ) {
      spaceEditorUpdateMovedSpaces();
    }
  };

  handleFloorplanClick = event => {
    const {
      elementType,
      spaceId,
      holeIndex,
      pointIndex,
      position,
      imagePoint,
      originalEvent,
    } = event;

    const {
      actions: {
        discardIncompleteShape,
        spaceEditorAddHoleToSpace,
        spaceEditorAddPointToSpace,
        spaceEditorAddPointToSelection,
        spaceEditorClearPointSelection,
        spaceEditorCreatePointSpace,
        spaceEditorRemovePointFromSelection,
        spaceEditorClearSelectedSpaces,
        spaceEditorSetCurrentlyEditedSpace,
        spaceEditorChangeSpaceName,
        spaceEditorSetSelectedSpaces,
        spaceEditorRemoveSpaceFromSelectedSpaces,
        editableShapeAddShapePoint,
        editableShapeRemoveShapePoint,
        editableShapeFinishEditing,
        showSpacePopup,
        closeSpacePopup,
        spaceEditorSetCurrentAddedTags,
        spaceEditorSetCurrentRemovedTags,
        setRenumberingCount,
        setRenumberingError,
        addRenumberingDuplicateNames,
        removeRenumberingDuplicateNames,
        spaceEditorSetSelectedMarkers,
        spaceEditorClearSelectedMarkers,
        toggleMarkersPanel,
      },
      spaceEditor: {
        hashSpacesForFloor,
        currentlyEditedPoints,
        currentlyEditedSpace,
        drawingSettings: { point, shape, drawCustom, spaceType },
        renumberingSettings,
        polylineAddPanelOpen,
        polylineEditPanelOpen,
        renumberingPanelOpen,
        markersPanelOpen,
        selectedSpaces,
        spacesEditMode,
        possibleSpaces,
        tags,
        workPointShapeIds,
        currentlyAddedTags,
        currentlyDeletedTags,
        liveViewSpaces,
        popup: { visible },
        markers,
      },
      customLayerSpaces,
      spaces,
      editableShape: { coordinates },
      bulkUpdate,
    } = this.props;
    const isPointType = spaceType ? spaceType.isPointType : false;
    if (spacesEditMode) {
      if (isPointType && polylineAddPanelOpen) {
        spaceEditorCreatePointSpace({ x: imagePoint.x, y: imagePoint.y });
        return;
      } else if (isPointType && markersPanelOpen) {
        spaceEditorCreatePointSpace({ x: imagePoint.x, y: imagePoint.y });
        return;
      } else if (drawCustom && !isPointType && polylineAddPanelOpen) {
        // Handle add space custom click events
        if (elementType === elementTypes.POINT && pointIndex === 0) {
          if (coordinates.length == 1) {
            spaceEditorClearSelectedSpaces();
            editableShapeRemoveShapePoint(pointIndex);
            return;
          }
          editableShapeFinishEditing(coordinates);
          return;
        }
        if (elementType === elementTypes.POINT) {
          spaceEditorClearSelectedSpaces();
          editableShapeRemoveShapePoint(pointIndex);
          return;
        } else {
          spaceEditorClearSelectedSpaces();
          editableShapeAddShapePoint({ x: imagePoint.x, y: imagePoint.y });
          return;
        }
      } else if (
        point &&
        polylineEditPanelOpen &&
        spaceId !== null &&
        spaceId !== undefined
      ) {
        // Handle edit polyline point mode click events
        if (elementType === elementTypes.SEGMENT) {
          spaceEditorAddPointToSpace({
            spaceId,
            point: { x: imagePoint.x, y: imagePoint.y },
            pointIndex,
            holeIndex,
          });
          return;
        }
        if (elementType === elementTypes.POINT) {
          if (coordinates.length > 0) {
            if (spaceId !== NEW_SPACE_ID) {
              // The user hasn't clocked on a point that's part of the current drawing so clear the drawing
              discardIncompleteShape();
            }
            if (pointIndex > 0) {
              editableShapeRemoveShapePoint(pointIndex);
            } else {
              spaceEditorAddHoleToSpace({
                coordinates,
                space: currentlyEditedSpace,
              });
            }

            return;
          }
          if (
            event.originalEvent &&
            (event.originalEvent.ctrlKey || event.originalEvent.metaKey)
          ) {
            let pointSelected = false;
            if (isNaN(holeIndex)) {
              pointSelected = !!currentlyEditedPoints.coordinates[pointIndex];
            } else {
              pointSelected =
                currentlyEditedPoints.holes[holeIndex] &&
                !!currentlyEditedPoints.holes[holeIndex][pointIndex];
            }
            if (pointSelected) {
              spaceEditorRemovePointFromSelection({ holeIndex, pointIndex });
            } else {
              spaceEditorAddPointToSelection({ holeIndex, pointIndex });
            }
            return;
          }
          spaceEditorClearPointSelection();
          spaceEditorAddPointToSelection({ holeIndex, pointIndex });
          return;
        }

        if (
          elementType === elementTypes.SPACE &&
          currentlyEditedSpace &&
          currentlyEditedSpace.id === spaceId
        ) {
          // The user has clicked inside the current space so add or update the hole
          editableShapeAddShapePoint({ x: imagePoint.x, y: imagePoint.y });
          return;
        }
      }
      if (this.getDrawingMode() === drawingModes.TAGGING) {
        return;
      }

      // Select clicked Marker
      if (elementType === elementTypes.MARKER && spaceId) {
        const clickedMarker = markers.spaces.find(
          space => space.id === spaceId
        );
        if (clickedMarker) {
          spaceEditorSetSelectedMarkers({
            [clickedMarker.id]: clickedMarker,
          });

          // Open markers Panel if not opened
          if (!markersPanelOpen) {
            toggleMarkersPanel();
          }

          // Clear Selected spaces if Marker is clicked
          if (!isEmpty(selectedSpaces)) {
            spaceEditorClearSelectedSpaces();
            closeSpacePopup();
          }
        }
        return;
      }
    }

    // If there is no element or space we're clearing the selection
    if (!elementType && !spaceId) {
      spaceEditorClearSelectedSpaces();
      closeSpacePopup();

      // Clear selected marker if clicked outside
      if (markers.selectedMarkers) {
        spaceEditorClearSelectedMarkers();
      }
      return;
    }

    let selectedSpace = spaces
      ? [...spaces, ...possibleSpaces.spaces, ...liveViewSpaces].find(
          space => space.id == spaceId
        )
      : null;
    if (!selectedSpace) {
      selectedSpace =
        customLayerSpaces &&
        customLayerSpaces.find(space => space.id === spaceId);
    }

    if (!selectedSpace) {
      spaceEditorClearSelectedSpaces();
      closeSpacePopup();
      return;
    }

    if (
      renumberingPanelOpen &&
      renumberingSettings.count >= 0 &&
      renumberingSettings.numberFormat &&
      renumberingSettings.spaceType &&
      renumberingSettings.templateText
    ) {
      if (selectedSpace.typeId === renumberingSettings.spaceType.id) {
        if (renumberingSettings.nextSpaceName === selectedSpace.name) return;
        if (
          spaces
            .map(space => space.name)
            .includes(renumberingSettings.nextSpaceName)
        ) {
          removeRenumberingDuplicateNames(selectedSpace.name);
          addRenumberingDuplicateNames(renumberingSettings.nextSpaceName);
        } else {
          removeRenumberingDuplicateNames(selectedSpace.name);
        }
        spaceEditorChangeSpaceName({
          space: selectedSpace,
          name: renumberingSettings.nextSpaceName,
        });
        setRenumberingCount(renumberingSettings.count + 1);
      } else {
        setRenumberingError();
      }
    } else if (spacesEditMode && polylineEditPanelOpen) {
      closeSpacePopup();
      if (point) {
        // Set the selected space
        spaceEditorSetSelectedSpaces({
          [selectedSpace.id]: selectedSpace,
        });
      } else if (shape) {
        // Add the space to the selection
        const newSelection =
          originalEvent && (originalEvent.ctrlKey || originalEvent.metaKey)
            ? { ...selectedSpaces }
            : {};
        newSelection[selectedSpace.id] = selectedSpace;
        spaceEditorSetSelectedSpaces(newSelection);
      }
      spaceEditorSetCurrentlyEditedSpace(selectedSpace);
    } else if (spacesEditMode && bulkUpdate.visible) {
      if (!!selectedSpaces[selectedSpace.id]) {
        spaceEditorRemoveSpaceFromSelectedSpaces(selectedSpace.id);
      } else {
        spaceEditorSetSelectedSpaces({
          ...selectedSpaces,
          [selectedSpace.id]: selectedSpace,
        });
      }
    } else {
      if (selectedSpace && selectedSpace.typeId == containerTypes.ZONE) {
        closeSpacePopup();
      } else if (!selectedSpace) {
        if (visible) closeSpacePopup();
        showSpacePopup({
          spaceId: spaceId,
          x: position.x,
          y: position.y,
        });
      } else {
        if (visible) closeSpacePopup();
        spaceEditorSetSelectedSpaces({
          [selectedSpace.id]: selectedSpace,
        });
        showSpacePopup({
          spaceId: spaceId,
          x: selectedSpace.shapes[0].labelPoint.x, // what to do if multiple shapes? Take the average?
          y: selectedSpace.shapes[0].labelPoint.y,
        });
      }
    }
  };

  handleFloorplanDoubleClick = event => {
    const { spaceId } = event;
    const {
      spaces,
      customLayerSpaces,
      actions: { openSpaceFormDrawer, loadVbsConfig },
      spaceEditor: {
        currentlyEditedSpace,
        drawingSettings: { point },
        polylineEditPanelOpen,
        spacesEditMode,
      },
      onSpaceDoubleClick,
    } = this.props;
    if (
      spacesEditMode &&
      polylineEditPanelOpen &&
      point &&
      currentlyEditedSpace &&
      currentlyEditedSpace.id === spaceId
    ) {
      return;
    }
    let spacesData = spaces.concat(customLayerSpaces);
    const space = spacesData.find(space => space.id === spaceId);
    if (!space) {
      return;
    }

    loadVbsConfig();
    onSpaceDoubleClick && onSpaceDoubleClick(space);
  };

  handleSpaceMouseEnter = space => {
    const {
      actions: { setHoveredSpaces },
      spaceEditor: { spacesForFloor },
    } = this.props;
    const itemsForHovering = [space.id.toString()];
    const parentSpaceId = space.workpointShapeId;
    const parentsChildren = spacesForFloor.filter(
      item => item.workpointShapeId === parentSpaceId
    );

    // Hover parent space if the parent has only one child
    if (parentSpaceId && parentsChildren.length === 1) {
      itemsForHovering.push(parentSpaceId.toString());
    }
    setHoveredSpaces(itemsForHovering);
  };

  handleSpaceMouseLeave = () => {
    const {
      actions: { setHoveredSpaces },
    } = this.props;

    setHoveredSpaces(null);
  };

  handleClosePopup = () => {
    const {
      actions: { closeSpacePopup, spaceEditorClearSelectedSpaces },
    } = this.props;
    closeSpacePopup();
    spaceEditorClearSelectedSpaces();
  };

  render() {
    const {
      floorId,
      labelOptions: {
        showOccupantLabels,
        showSpaceNameLabels,
        showSpaceTypeLabels,
        showSpacePreferredNameLabels,
        labelFontSize,
      },
      spaceEditor,
      spaces,
      customLayerSpaces,
      uiViewerFloorscale,
      editableShape,
      spaceRuler,
      uiMouseTracker: { dragTarget },
    } = this.props;

    const {
      currentlyEditedSpace,
      currentlyEditedPoints,
      drawingSettings: { drawCustom, spaceType },
      polylineEditPanelOpen,
      renumberingPanelOpen,
      selectedSpaces,
      spaceChanges: { invalidSpaces },
      spacesEditMode,
      equipmentAndReporting,
      legend,
      popup: {
        visible: popupVisible,
        spaceId: popupSpaceId,
        x: popupX,
        y: popupY,
        inMemoryPopup,
      },
      currentSpace: { loading: spacePopupLoading },
      tags,
      hashSpacesForFloor,
      tagChanges: { newPaintedHashTags },
      liveViewSpaces,
      hoveredSpaces,
      markersPanelOpen,
      markers,
    } = spaceEditor;
    const { legendType } = legend;

    if (!floorId) {
      return null;
    }

    const { selectionRect } = this.state;

    // render polygons first, everything else second
    const sortedSpaces = spaces
      .filter((space, b) => {
        return space.shapes;
      })
      .sort((a, b) => {
        return !a.shapes[0].isPolygon;
      });

    const sortedSelectedSpaces = Object.values(selectedSpaces)
      .filter((space, b) => {
        return space.shapes;
      })
      .sort((a, b) => {
        return !a.shapes[0].isPolygon;
      });

    const floorLabels = getLabelsForSpaces(
      sortedSpaces,
      showSpaceNameLabels,
      showOccupantLabels,
      showOccupantLabels,
      showSpaceTypeLabels,
      showSpacePreferredNameLabels
    );

    const customLayerLabels = customLayerSpaces
      ? getLabelsForSpaces(
          customLayerSpaces,
          showSpaceNameLabels,
          showOccupantLabels,
          showOccupantLabels,
          showSpaceTypeLabels,
          showSpacePreferredNameLabels
        )
      : [];

    const pointSize =
      uiViewerFloorscale && uiViewerFloorscale[floorId]
        ? uiViewerFloorscale[floorId].pointSize
        : DEFAULT_POINT_SIZE;

    const markerSize =
      uiViewerFloorscale && uiViewerFloorscale[floorId]
        ? uiViewerFloorscale[floorId].markerSize
        : DEFAULT_MARKER_SIZE;

    const unoccupied = legendType === legendTypes.UNOCCUPIED;
    const isPointType = spaceType ? spaceType.isPointType : false;

    const hasCurrentlyEditedSpace =
      currentlyEditedSpace &&
      currentlyEditedSpace.shapes &&
      currentlyEditedSpace.shapes.length > 0;

    const currentDrawingMode = this.getDrawingMode();
    let cursor = "";
    switch (currentDrawingMode) {
      case drawingModes.TAGGING:
        if (tags.active && tags.paintActive) {
          cursor = tagIcon;
        }
        if (tags.active && tags.eraseActive) {
          cursor = tagEraserIcon;
        }
        break;
      case drawingModes.CREATE_SPACE_RECTANGLE:
      case drawingModes.CREATE_SPACE_CUSTOM:
      case drawingModes.CREATE_SPACE_POINT:
      case drawingModes.DRAW_RULER:
      case drawingModes.CREATE_MARKERS:
        cursor = "crosshair";
        break;
    }
    if (renumberingPanelOpen) cursor = "crosshair";
    const editingASpace =
      currentDrawingMode === drawingModes.EDIT_SPACE && hasCurrentlyEditedSpace;

    let pointIndex;
    if (dragTarget) {
      pointIndex = dragTarget.pointIndex;
    }

    // Flattened array with markers for selecting the icon svg
    const allMarkerTypes =
      markers.items &&
      markers.items.children.map(items => items.children).flat();

    return (
      <Floorplan
        floorId={floorId}
        onFloorplanPressed={this.handleFloorplanPress}
        onFloorplanDrag={this.handleFloorplanDrag}
        onFloorplanReleased={this.handleFloorplanRelease}
        onFloorplanClicked={this.handleFloorplanClick}
        onFloorplanDoubleClicked={this.handleFloorplanDoubleClick}
        cursor={cursor}
        forceReload={spacePopupLoading}
      >
        {
          <FloorplanShapes id={`non-editable-spaces-floor-${floorId}`}>
            {legendType === legendTypes.LIVE_VIEW &&
              liveViewSpaces.map((space, index) => {
                return (
                  <Shape
                    key={this.getKey(space.id, index)}
                    drawTriangle={unoccupied && space.isFlexi}
                    isPoint={unoccupied && space.isFlexi}
                    pointSize={pointSize}
                    shape={space.shapes ? space.shapes[0] : null}
                    space={space}
                    style={getSpaceStyle(
                      space,
                      space.shapes[0],
                      legend,
                      !!selectedSpaces[space.id],
                      invalidSpaces[space.id],
                      isSpacePaintedTag(spaceEditor, space) ||
                        isSpaceErased(spaceEditor, space)
                    )}
                    isSelected={!!selectedSpaces[space.id]}
                  />
                );
              })}
            {sortedSpaces.map((space, index) => {
              if (editingASpace && space.id === currentlyEditedSpace.id) {
                return null;
              } else if (
                selectedSpaces.hasOwnProperty(space.id) &&
                popupSpaceId !== space.id
              ) {
                return null;
              } else {
                const isHovered = hoveredSpaces
                  ? hoveredSpaces.includes(space.id.toString())
                  : false;
                return (
                  <Shape
                    key={this.getKey(space.id, index)}
                    drawTriangle={unoccupied && space.isFlexi}
                    isPoint={unoccupied && space.isFlexi}
                    pointSize={pointSize}
                    shape={space.shapes ? space.shapes[0] : null}
                    space={space}
                    style={getSpaceStyle(
                      space,
                      space.shapes[0],
                      legend,
                      !!selectedSpaces[space.id],
                      invalidSpaces[space.id],
                      isSpacePaintedTag(spaceEditor, space) ||
                        isSpaceErased(spaceEditor, space),
                      isHovered
                    )}
                    isSelected={!!selectedSpaces[space.id]}
                    handleSpaceMouseEnter={this.handleSpaceMouseEnter}
                    handleSpaceMouseLeave={this.handleSpaceMouseLeave}
                    containerId={`non-editable-spaces-floor-${floorId}`}
                  />
                );
              }
            })}
          </FloorplanShapes>
        }
        {
          <FloorplanShapes id={`movable-editable-spaces-floor-${floorId}`}>
            {sortedSelectedSpaces.map((space, index) => {
              if (
                (editingASpace && space.id === currentlyEditedSpace.id) ||
                popupSpaceId === space.id
              ) {
                return null;
              }
              return (
                <Shape
                  key={this.getKey(space.id, index)}
                  drawTriangle={unoccupied && space.isFlexi}
                  isPoint={unoccupied && space.isFlexi}
                  pointSize={pointSize}
                  shape={space.shapes ? space.shapes[0] : null}
                  space={space}
                  style={
                    isCustomLayer(space.typeId, spaceEditor)
                      ? getSpaceCustomLayerStyle(
                          space,
                          space.shapes[0],
                          equipmentAndReporting,
                          !!selectedSpaces[space.id]
                        )
                      : getSpaceStyle(
                          space,
                          space.shapes[0],
                          legend,
                          !!selectedSpaces[space.id],
                          invalidSpaces[space.id],
                          isSpacePaintedTag(spaceEditor, space) ||
                            isSpaceErased(spaceEditor, space)
                        )
                  }
                  forceUpdate={true}
                  isSelected={!!selectedSpaces[space.id]}
                  containerId={`movable-editable-spaces-floor-${floorId}`}
                />
              );
            })}
          </FloorplanShapes>
        }
        <FloorplanShapes
          id={`non-editable-custom-layer-spaces-floor-${floorId}`}
        >
          {customLayerSpaces.map((space, index) => {
            if (editingASpace && space.id === currentlyEditedSpace.id) {
              return null;
            } else if (selectedSpaces.hasOwnProperty(space.id)) {
              return null;
            } else {
              const isHovered = hoveredSpaces
                ? hoveredSpaces.includes(space.id.toString())
                : false;
              return (
                <Shape
                  key={this.getKey(space.id, index)}
                  drawTriangle={unoccupied && space.isFlexi}
                  isPoint={unoccupied && space.isFlexi}
                  pointSize={pointSize}
                  shape={space.shapes ? space.shapes[0] : null}
                  space={space}
                  style={getSpaceCustomLayerStyle(
                    space,
                    space.shapes[0],
                    equipmentAndReporting,
                    !!selectedSpaces[space.id],
                    isHovered
                  )}
                  isSelected={!!selectedSpaces[space.id]}
                  handleSpaceMouseEnter={this.handleSpaceMouseEnter}
                  handleSpaceMouseLeave={this.handleSpaceMouseLeave}
                  containerId={`non-editable-custom-layer-spaces-floor-${floorId}`}
                />
              );
            }
          })}
        </FloorplanShapes>
        <FloorplanShapes id={`markers-spaces-floor-${floorId}`}>
          {markers.spaces &&
            markers.spaces.map(marker => {
              if (markers.selectedSpaceTypeHash[marker.typeId] !== true) {
                return null;
              }

              const isHovered = hoveredSpaces
                ? hoveredSpaces.includes(marker.id.toString())
                : false;
              const markerIcon = allMarkerTypes
                ? allMarkerTypes.find(
                    markerType => markerType.id === marker.typeId
                  ).icon
                : "";
              return (
                <MarkerShape
                  key={marker.id}
                  marker={marker}
                  icon={markerIcon}
                  markerSize={markerSize}
                  isHovered={isHovered}
                  isSelected={
                    !!(
                      markers.selectedMarkers &&
                      markers.selectedMarkers[marker.id]
                    )
                  }
                  handleSpaceMouseEnter={this.handleSpaceMouseEnter}
                  handleSpaceMouseLeave={this.handleSpaceMouseLeave}
                  containerId={`markers-spaces-floor-${floorId}`}
                />
              );
            })}
        </FloorplanShapes>
        <FloorplanLabels>
          {floorLabels.map(label =>
            label.lines.map((_, index) => this.createLabel(label, index))
          )}
          {customLayerLabels.map(label =>
            label.lines.map((_, index) => this.createLabel(label, index))
          )}
        </FloorplanLabels>
        {editingASpace && (
          <FloorplanShapes id={`editable-spaces-floor-${floorId}`}>
            <Shape
              key={`editable-shape-background-${
                currentlyEditedSpace.id
              }-floor-${floorId}`}
              drawTriangle={unoccupied && currentlyEditedSpace.isFlexi}
              isPoint={unoccupied && currentlyEditedSpace.isFlexi}
              pointSize={pointSize}
              shape={
                currentlyEditedSpace.shapes
                  ? currentlyEditedSpace.shapes[0]
                  : null
              }
              space={currentlyEditedSpace}
              style={
                isCustomLayer(currentlyEditedSpace.typeId, spaceEditor)
                  ? getSpaceCustomLayerStyle(
                      currentlyEditedSpace,
                      currentlyEditedSpace.shapes[0],
                      equipmentAndReporting
                    )
                  : getSpaceStyle(
                      currentlyEditedSpace,
                      currentlyEditedSpace.shapes[0],
                      legend,
                      !!selectedSpaces[currentlyEditedSpace.id] &&
                        !currentlyEditedSpace.shapes[0]
                    )
              }
              forceUpdate={true}
              containerId={`editable-spaces-floor-${floorId}`}
            />
            <EditableShape
              closed={true}
              shape={currentlyEditedSpace.shapes[0]}
              drawLines={true}
              key={`editable-shape-${currentlyEditedSpace.id}-floor-${floorId}`}
              pointSize={pointSize}
              selectedPoints={currentlyEditedPoints}
              space={currentlyEditedSpace}
              draggedPointIndex={pointIndex}
            />
          </FloorplanShapes>
        )}
        {spacesEditMode && drawCustom && !isPointType && spaceType && (
          <FloorplanShapes
            id={`drawing-possible-editable-space-floor-${floorId}`}
          >
            {/* editableShape state current drawing */}
            <EditableShape
              key={`custom-editable-shape-${NEW_SPACE_ID}-floor-${floorId}`}
              pointSize={20}
              shape={editableShape}
              space={{ id: NEW_SPACE_ID }}
              drawLines={true}
            />
          </FloorplanShapes>
        )}
        {spacesEditMode &&
          currentlyEditedSpace &&
          editableShape &&
          editableShape.coordinates.length > 0 && (
            <FloorplanShapes id={`drawing-new-hole-${floorId}`}>
              {/* editableShape state current drawing */}
              <EditableShape
                key={`custom-editable-shape-${NEW_SPACE_ID}-floor-${floorId}`}
                pointSize={20}
                shape={editableShape}
                space={{ id: NEW_SPACE_ID }}
                drawLines={true}
              />
            </FloorplanShapes>
          )}
        {selectionRect && (
          <FloorplanShapes id={`rect-${floorId}`}>
            <FloorplanRectUiHelper
              left={selectionRect.left}
              right={selectionRect.right}
              top={selectionRect.top}
              bottom={selectionRect.bottom}
            />
          </FloorplanShapes>
        )}
        {popupVisible && !inMemoryPopup && (
          <FloorplanPopup x={popupX} y={popupY}>
            <SpacePopupCard
              key={`space_card_${popupSpaceId}`}
              spaceId={popupSpaceId}
              customLayerSpaces={customLayerSpaces}
              onPopupClose={this.handleClosePopup}
              isSpaces={true}
            />
          </FloorplanPopup>
        )}
        {spaceRuler.visible && (
          <FloorplanShapes id={`ruler-${floorId}`}>
            <Ruler
              uiViewerFloorscale={
                uiViewerFloorscale ? uiViewerFloorscale[floorId] : 1
              }
              displayPrecision={2}
            />
          </FloorplanShapes>
        )}
        <FloorplanShapes>
          {tags.active &&
            tags.tagHash[tags.active.id] &&
            tags.tagHash[tags.active.id].map(space => {
              return (
                !isSpaceErased(spaceEditor, space) &&
                selectedSpaces[space.id] && (
                  <TagIcon
                    space={space}
                    offsetY={labelFontSize - 3}
                    size={pointSize}
                  />
                )
              );
            })}
          {tags.active &&
            newPaintedHashTags[tags.active.id] &&
            newPaintedHashTags[tags.active.id].map(spaceId => {
              const space = hashSpacesForFloor[spaceId];
              return (
                <TagIcon
                  space={space}
                  offsetY={labelFontSize - 3}
                  size={pointSize}
                />
              );
            })}
        </FloorplanShapes>
      </Floorplan>
    );
  }
}

export const SpacesFloorplan = flow(
  hot(module),
  withAnalytics,
  injectIntl
)(
  withRedux(SpacesFloorplanWrapper, {
    states: [
      "colorBy",
      "labelOptions",
      "uiMouseTracker",
      "uiViewerFloorscale",
      "spaceEditor",
      "spaceRuler",
      "editableShape",
      "configuration",
      "bulkUpdate",
    ],
  })
);
